#!/usr/bin/env node
// Runs before `publish` (prepublishOnly). Stops a publish with npm or yarn: only pnpm applies
// `publishConfig.exports`, so another tool would publish `exports` that point at `src/`, which is
// not in the package.

const agent = process.env.npm_config_user_agent ?? ''
if (!agent.startsWith('pnpm/')) {
  console.error('[check-publish] Publish with pnpm (pnpm publish). Only pnpm swaps in publishConfig.exports.')
  process.exit(1)
}
