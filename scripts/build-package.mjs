#!/usr/bin/env node
// Builds the package from `src` to `dist`. Run it from the package folder:
//   node scripts/build-package.mjs
//
// 1. Compiles with the package's TypeScript (`tsconfig.build.json`): ESM JS plus `.d.ts`, one
//    output file per source file, so module boundaries and 'use client' directives stay as they are.
// 2. Adds `.js` (or `/index.js`) to relative import paths, so Node's ESM loader (Payload CLI,
//    `payload run`, tsx) can load the output, not only bundlers.
// 3. Copies `.scss` and `.css` files next to the JS. The app's Next.js compiles them, the same way
//    it compiles the SCSS that `@payloadcms/ui` ships.
// 4. Checks that `publishConfig.exports` maps every `exports` entry to the matching `dist` file.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const pkgDir = process.cwd()
const srcDir = path.join(pkgDir, 'src')
const distDir = path.join(pkgDir, 'dist')
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
const ASSET_EXTENSIONS = ['.scss', '.css']

function fail(message) {
  console.error(`[build-package] ${pkg.name}: ${message}`)
  process.exit(1)
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

// 1. Compile ------------------------------------------------------------------------------------

fs.rmSync(distDir, { recursive: true, force: true })

const require = createRequire(path.join(pkgDir, 'package.json'))
const tsPkgPath = require.resolve('typescript/package.json')
const tsPkg = JSON.parse(fs.readFileSync(tsPkgPath, 'utf8'))
const tscBin = path.join(path.dirname(tsPkgPath), typeof tsPkg.bin === 'string' ? tsPkg.bin : tsPkg.bin.tsc)

const tsc = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.build.json'], { cwd: pkgDir, stdio: 'inherit' })
if (tsc.status !== 0) fail(`tsc failed with exit code ${tsc.status}`)

// 2. Relative import paths -----------------------------------------------------------------------

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"]*)\2/g
const KNOWN_EXTENSION = /\.(m?js|cjs|json|s?css)$/

function withExtension(file, specifier) {
  if (KNOWN_EXTENSION.test(specifier)) return specifier
  const base = path.resolve(path.dirname(file), specifier)
  if (fs.existsSync(`${base}.js`)) return `${specifier}.js`
  if (fs.existsSync(path.join(base, 'index.js'))) return `${specifier.replace(/\/$/, '')}/index.js`
  fail(`cannot resolve "${specifier}" in ${path.relative(pkgDir, file)}`)
}

for (const file of walk(distDir)) {
  if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
  const code = fs.readFileSync(file, 'utf8')
  const next = code.replace(SPECIFIER, (_, prefix, quote, specifier) => `${prefix}${quote}${withExtension(file, specifier)}${quote}`)
  if (next !== code) fs.writeFileSync(file, next)
}

// 3. Assets --------------------------------------------------------------------------------------

let assets = 0
for (const file of walk(srcDir)) {
  if (!ASSET_EXTENSIONS.includes(path.extname(file))) continue
  const target = path.join(distDir, path.relative(srcDir, file))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(file, target)
  assets++
}

// 4. Exports check -------------------------------------------------------------------------------

function distEntry(sourcePath) {
  const rel = sourcePath.replace(/^\.\/src\//, '').replace(/\.tsx?$/, '')
  return { types: `./dist/${rel}.d.ts`, default: `./dist/${rel}.js` }
}

const expected = Object.fromEntries(Object.entries(pkg.exports ?? {}).map(([key, value]) => [key, distEntry(value)]))
const actual = pkg.publishConfig?.exports ?? {}
if (JSON.stringify(expected) !== JSON.stringify(actual)) {
  fail(
    `publishConfig.exports does not match exports. Set it to:\n${JSON.stringify(expected, null, 2)}`,
  )
}
for (const entry of Object.values(expected)) {
  for (const file of Object.values(entry)) {
    if (!fs.existsSync(path.join(pkgDir, file))) fail(`export target ${file} was not emitted`)
  }
}

const jsFiles = walk(distDir).filter((f) => f.endsWith('.js')).length
console.log(`[build-package] ${pkg.name}: ${jsFiles} modules, ${assets} stylesheets -> dist/`)
