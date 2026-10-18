// Resets the dev database to a demo state: a user, posts, three visual workflows, and finished
// example jobs for the run viewer. Run with `pnpm dev:seed`. It deletes posts, activity, workflows
// and jobs first.
import { getPayload } from 'payload'

import type { WorkflowGraph } from '../src/core/types'

import { autoLayout } from '../src/core/graph'
import { queueWorkflowRun } from '../src/index'
import config, { DEV_USER } from './payload.config'

const payload = await getPayload({ config })
const at = { x: 0, y: 0 }

for (const collection of ['posts', 'activity', 'workflows', 'payload-jobs'] as const) {
  await payload.delete({ collection, overrideAccess: true, where: { id: { exists: true } } })
}

const users = await payload.find({ collection: 'users', limit: 1, where: { email: { equals: DEV_USER.email } } })
if (users.totalDocs === 0) await payload.create({ collection: 'users', data: DEV_USER })

const onPublish: WorkflowGraph = autoLayout({
  edges: [
    { id: 'e1', source: 'trigger', target: 'logActivity' },
    { id: 'e2', source: 'logActivity', target: 'isFeatured' },
    { id: 'e3', source: 'isFeatured', sourceHandle: 'true', target: 'pingNewsletter' },
    { id: 'e4', source: 'pingNewsletter', target: 'emailSubscribers' },
    { id: 'e5', source: 'isFeatured', sourceHandle: 'false', target: 'emailEditors' },
  ],
  nodes: [
    {
      data: {
        collection: 'posts',
        filter: { match: 'all', rules: [{ left: '{{trigger.doc.status}}', operator: 'equals', right: 'published' }] },
        kind: 'collection',
        operations: ['create', 'update'],
      },
      id: 'trigger',
      position: at,
      type: 'trigger',
    },
    {
      data: {
        input: { collection: 'activity', data: '{"message": "Published: {{trigger.doc.title}}"}' },
        label: 'Log activity',
        task: 'createDocument',
      },
      id: 'logActivity',
      position: at,
      type: 'task',
    },
    {
      data: { label: 'Is it featured?', match: 'all', rules: [{ left: '{{trigger.doc.featured}}', operator: 'equals', right: 'true' }] },
      id: 'isFeatured',
      position: at,
      type: 'condition',
    },
    {
      data: {
        input: { body: '{"post": "{{trigger.doc.id}}"}', method: 'POST', simulateFailure: true, url: 'https://hooks.example.com/newsletter' },
        label: 'Ping newsletter service',
        task: 'httpRequest',
      },
      id: 'pingNewsletter',
      position: at,
      type: 'task',
    },
    {
      data: {
        input: { body: 'Read it now: {{trigger.doc.title}}', subject: 'Featured: {{trigger.doc.title}}', to: 'subscribers@example.com' },
        label: 'Email subscribers',
        task: 'sendEmail',
      },
      id: 'emailSubscribers',
      position: at,
      type: 'task',
    },
    {
      data: {
        input: { subject: 'Published: {{trigger.doc.title}}', to: '{{trigger.doc.authorEmail}}' },
        label: 'Email the author',
        task: 'sendEmail',
      },
      id: 'emailEditors',
      position: at,
      type: 'task',
    },
  ],
})

const weekly: WorkflowGraph = autoLayout({
  edges: [
    { id: 'e1', source: 'trigger', target: 'fetchStats' },
    { id: 'e2', source: 'fetchStats', target: 'emailTeam' },
  ],
  nodes: [
    { data: { cron: '0 9 * * 1', kind: 'schedule' }, id: 'trigger', position: at, type: 'trigger' },
    { data: { input: { method: 'GET', url: 'https://analytics.example.com/weekly' }, label: 'Fetch stats', task: 'httpRequest' }, id: 'fetchStats', position: at, type: 'task' },
    {
      data: { input: { body: 'Stats service answered {{steps.fetchStats.output.status}}.', subject: 'Weekly report', to: 'team@example.com' }, task: 'sendEmail' },
      id: 'emailTeam',
      position: at,
      type: 'task',
    },
  ],
})

const followUp: WorkflowGraph = autoLayout({
  edges: [
    { id: 'e1', source: 'trigger', target: 'welcome' },
    { id: 'e2', source: 'welcome', target: 'wait' },
    { id: 'e3', source: 'wait', target: 'followUp' },
  ],
  nodes: [
    { data: { kind: 'manual', sampleData: { email: 'new.customer@example.com', name: 'Ada' } }, id: 'trigger', position: at, type: 'trigger' },
    { data: { input: { subject: 'Welcome, {{trigger.data.name}}', to: '{{trigger.data.email}}' }, label: 'Welcome email', task: 'sendEmail' }, id: 'welcome', position: at, type: 'task' },
    { data: { amount: 2, unit: 'days' }, id: 'wait', position: at, type: 'delay' },
    { data: { input: { subject: 'How is it going?', to: '{{trigger.data.email}}' }, label: 'Follow-up email', task: 'sendEmail' }, id: 'followUp', position: at, type: 'task' },
  ],
})

const create = (title: string, graph: WorkflowGraph, enabled = true) =>
  payload.create({ collection: 'workflows', data: { enabled, graph, title } as never, overrideAccess: true })

await create('Notify on publish', onPublish)
await create('Weekly report', weekly)
const welcome = await create('Welcome series', followUp, false)

const run = async (queue: string, times = 1) => {
  for (let i = 0; i < times; i++) await payload.jobs.run({ queue, silent: true })
}

// A single-task job.
await payload.jobs.queue({ input: { subject: 'Hello from a single task', to: 'someone@example.com' }, task: 'sendEmail' })
await run('default')

// A code-defined workflow whose second task fails once, then succeeds on the retry.
await payload.jobs.queue({ input: { postId: 'demo' }, workflow: 'publishDigest' })
await run('default', 2)

// Visual workflow runs, started by collection events: one featured post (Yes branch, with a
// retry), one normal post (No branch).
await payload.create({ collection: 'posts', data: { authorEmail: 'ada@example.com', featured: true, status: 'published', title: 'Launching payload-workflows' } })
await payload.create({ collection: 'posts', data: { authorEmail: 'grace@example.com', featured: false, status: 'published', title: 'Release notes 0.1' } })
await payload.create({ collection: 'posts', data: { status: 'draft', title: 'An unfinished draft' } })
await run('workflows', 2)

// A manual run that stops at the Delay and continues in a later job.
const req = { payload, context: {} } as never
await queueWorkflowRun({ req, trigger: { data: { email: 'new.customer@example.com', name: 'Ada' }, kind: 'manual' }, workflow: welcome as never })
await run('workflows')

const jobs = await payload.find({ collection: 'payload-jobs', limit: 50, overrideAccess: true, sort: 'createdAt' })
for (const job of jobs.docs) {
  const label = job.workflowSlug ?? job.taskSlug
  const state = job.completedAt ? 'completed' : job.hasError ? 'failed' : 'pending'
  console.log(`job ${job.id}: ${label} ${state}, ${job.log?.length ?? 0} log entries`)
}
process.exit(0)
