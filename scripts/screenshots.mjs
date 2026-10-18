// Takes the README screenshots from the running dev app (`pnpm dev:seed`, then `pnpm dev`).
// Saves light and dark versions of each view to docs/screenshots/.
//   node scripts/screenshots.mjs [baseURL]
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:3060'
const out = 'docs/screenshots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()

async function shoot(theme) {
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { height: 1000, width: 1600 } })
  await context.addCookies([{ name: 'payload-theme', url: base, value: theme }])
  const page = await context.newPage()

  // The dev config logs in automatically.
  await page.goto(`${base}/admin`)
  await page.waitForURL(/\/admin(?!\/login)/)

  const jobs = await (await page.request.get(`${base}/api/payload-jobs?limit=50&depth=0&sort=createdAt`)).json()
  const single = jobs.docs.find((job) => job.taskSlug === 'sendEmail')
  const code = jobs.docs.find((job) => job.workflowSlug === 'publishDigest')
  const visual = jobs.docs
    .filter((job) => job.input?.workflowTitle === 'Notify on publish')
    .toSorted((a, b) => (b.log?.length ?? 0) - (a.log?.length ?? 0))[0]
  const workflows = await (await page.request.get(`${base}/api/workflows?limit=10&depth=0`)).json()
  const workflow = workflows.docs.find((doc) => doc.title === 'Notify on publish')

  async function openRun(id) {
    await page.goto(`${base}/admin/collections/payload-jobs/${id}/run`)
    await page.locator('.react-flow__node').first().waitFor()
    await page.waitForTimeout(600)
  }

  async function capture(name) {
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.querySelector('.template-default__wrap, main')?.scrollTo?.(0, 0) ?? window.scrollTo(0, 0))
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}/${name}-${theme}.png` })
  }

  await openRun(single.id)
  await page.locator('.react-flow__node').first().click()
  await capture('run-single-task')

  await openRun(code.id)
  await page.getByRole('button', { name: /Attempt 1/ }).click()
  await page.waitForTimeout(500)
  await page.locator('.react-flow__node', { hasText: 'notify-webhook' }).click()
  await capture('run-code-workflow-retry')

  await openRun(visual.id)
  await page.locator('.react-flow__node', { hasText: 'Is it featured?' }).click()
  await capture('run-visual-workflow')

  await page.goto(`${base}/admin/collections/workflows/${workflow.id}`)
  await page.locator('.pw-editor .react-flow__node').first().waitFor()
  await page.waitForTimeout(800)
  await page.locator('.react-flow__node', { hasText: 'Email subscribers' }).click()
  await capture('builder')

  await context.close()
}

for (const theme of ['light', 'dark']) await shoot(theme)
await browser.close()
console.log(`Saved screenshots to ${out}/`)
