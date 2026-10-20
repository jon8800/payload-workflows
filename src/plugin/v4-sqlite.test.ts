import { afterAll, beforeAll, expect, test } from 'vitest'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, createPayloadRequest, getPayload, type Payload } from 'payload'
import type { WorkflowGraph } from '../core/types'
import { workflowsPlugin } from './plugin'
import { queueWorkflowRun } from './runner'

let payload: Payload
const messages: string[] = []

beforeAll(async () => {
  payload = await getPayload({ config: buildConfig({
    secret: 'isolated-workflows-v4-test-secret',
    db: sqliteAdapter({ client: { url: 'file::memory:' }, push: true }),
    typescript: { autoGenerate: false },
    collections: [{ slug: 'users', auth: true, fields: [] }],
    jobs: {
      access: { queue: ({ req }) => !!req.user, run: ({ req }) => !!req.user },
      tasks: [{ slug: 'exampleLog', inputSchema: [{ name: 'message', type: 'text' }],
        handler: async ({ input }) => { messages.push(input.message); return { output: {} } } }],
    },
    plugins: [workflowsPlugin({ autoRun: false })],
  }) })
})

afterAll(async () => {
  await payload?.destroy()
  ;(payload?.db as unknown as { client?: { close: () => void } })?.client?.close()
})

test('v4 executes an authorized manual job and a delayed worker continuation in SQLite', async () => {
  const user = await payload.create({ collection: 'users', data: { email: 'workflow@example.com', password: 'synthetic-test-password-1!' }, overrideAccess: true })
  const req = await createPayloadRequest({ payload, user: { ...user, collection: 'users' } })
  const graph: WorkflowGraph = {
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'manual' } },
      { id: 'delay', type: 'delay', position: { x: 200, y: 0 }, data: { amount: 1, unit: 'seconds' } },
      { id: 'log', type: 'task', position: { x: 400, y: 0 }, data: { task: 'exampleLog', input: { message: 'continued in v4' } } },
    ],
    edges: [{ id: 't-d', source: 'trigger', target: 'delay' }, { id: 'd-l', source: 'delay', target: 'log' }],
  }
  const workflow = { id: 1, title: 'Synthetic delay', graph }
  const job = await queueWorkflowRun({ req, workflow, trigger: {} })
  await payload.jobs.runByID({ id: job.id, req, overrideAccess: false })
  const completed = await payload.findByID({ collection: 'payload-jobs', id: job.id, overrideAccess: true })
  expect(completed.completedAt).toBeTruthy()
  expect(completed.hasError).not.toBe(true)
  expect(messages).toEqual([])

  const pending = await payload.find({ collection: 'payload-jobs', where: { completedAt: { exists: false } }, overrideAccess: true })
  expect(pending.docs).toHaveLength(1)
  const continuation = pending.docs[0]
  if (!continuation) throw new Error('Missing continuation job')
  expect((continuation.input as { resume: { parentJob: number } }).resume.parentJob).toBe(job.id)
  await payload.update({ collection: 'payload-jobs', id: continuation.id, data: { waitUntil: new Date(Date.now() - 1000).toISOString() }, overrideAccess: true })
  // Cron workers have no interactive user. The accepted workflow authorizes its continuation.
  await payload.jobs.runByID({ id: continuation.id, overrideAccess: true })
  const final = await payload.findByID({ collection: 'payload-jobs', id: continuation.id, overrideAccess: true })
  expect(final.completedAt).toBeTruthy()
  expect(final.hasError).not.toBe(true)
  expect(messages).toEqual(['continued in v4'])
})
