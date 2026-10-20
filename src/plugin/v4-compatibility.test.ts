import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { PayloadRequest } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'

import type { WorkflowGraph } from '../core/types'
import { jobState } from '../core/runs'
import { emptyGraph, workflowsCollection } from './collection'
import { resolveOptions } from './options'
import { queueWorkflowRun, runWorkflowConfig } from './runner'
import { queueDueWorkflows } from './triggers'

function fixture() {
  const queued: Record<string, unknown>[] = []
  const started: Record<string, unknown>[] = []
  const options = resolveOptions({ autoRun: false }, { admin: { user: 'users' }, secret: 'fixture', db: sqliteAdapter({ client: { url: 'file::memory:' } }) })
  const workflow = { id: 1, title: 'Example', graph: emptyGraph() }
  const req = {
    context: {}, user: { id: 7, collection: 'users' }, routeParams: { id: '1' },
    payload: {
      config: { custom: { payloadWorkflows: options }, jobs: { tasks: [] } },
      findByID: async () => workflow,
      find: async () => ({ docs: [] }),
      update: async () => undefined,
      logger: { error: () => assert.fail('Job failed'), warn: () => undefined },
      jobs: {
        queue: async (args: Record<string, unknown>) => { queued.push(args); return { id: 23 } },
        runByID: async (args: Record<string, unknown>) => { started.push(args) },
      },
    },
  } as unknown as PayloadRequest
  return { options, workflow, req, queued, started }
}

test('run viewer recognizes the v4 job lease and does not show expired leases as running', () => {
  const now = Date.parse('2026-10-20T00:00:00Z')
  assert.equal(jobState({ id: 1, processingUntil: '2026-10-20T00:00:30Z' }, now), 'running')
  assert.equal(jobState({ id: 1, processingUntil: '2026-10-19T23:59:59Z' }, now), 'queued')
})

test('manual runs keep the user request and honor both v4 jobs access checks', async () => {
  const { options, req, queued, started } = fixture()
  const endpoints = workflowsCollection(options).endpoints
  assert.ok(endpoints)
  const endpoint = endpoints[0]
  assert.ok(endpoint)
  const response = await endpoint.handler(req)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { jobId: 23 })
  assert.ok(queued[0])
  assert.equal(queued[0].req, req)
  assert.ok(queued[0])
  assert.equal(queued[0].overrideAccess, false)
  assert.deepEqual(started, [{ id: 23, req, overrideAccess: false }])
})

test('manual access denial queues and starts nothing', async () => {
  const { options, req, queued, started } = fixture()
  req.user = null
  const endpoints = workflowsCollection(options).endpoints
  assert.ok(endpoints)
  const endpoint = endpoints[0]
  assert.ok(endpoint)
  const response = await endpoint.handler(req)
  assert.equal(response.status, 403)
  assert.equal(queued.length, 0)
  assert.equal(started.length, 0)
})

test('queue helper does not bypass access unless a trusted caller requests it', async () => {
  const { req, workflow, queued } = fixture()
  await queueWorkflowRun({ req, workflow, trigger: {} })
  assert.ok(queued[0])
  assert.equal(queued[0].overrideAccess, false)
})

test('scheduled automation can queue without an interactive user', async () => {
  const { req, workflow, queued } = fixture()
  req.user = null
  req.payload.find = async () => ({ docs: [{ ...workflow, cron: '* * * * *' }] }) as never
  assert.equal(await queueDueWorkflows(req), 1)
  assert.ok(queued[0])
  assert.equal(queued[0].overrideAccess, true)
  assert.ok(queued[0])
  assert.equal(queued[0].req, req)
})

test('delayed continuation uses its worker request and trusted access', async () => {
  const { options, req, workflow, queued } = fixture()
  req.user = null
  const graph: WorkflowGraph = {
    nodes: [...workflow.graph.nodes, { id: 'wait', type: 'delay', position: { x: 0, y: 100 }, data: { amount: 1, unit: 'seconds' } }],
    edges: [{ id: 't-w', source: 'trigger', target: 'wait' }],
  }
  const handler = runWorkflowConfig(options).handler
  assert.equal(typeof handler, 'function')
  if (typeof handler !== 'function') throw new Error('Missing handler')
  await handler({
    req, tasks: {}, job: { id: 1, queue: 'workflows', input: { graph, workflowId: '1', trigger: {} } },
    inlineTask: async (_id: string, args: { task: (args: { req: PayloadRequest }) => Promise<{ output: unknown }> }) => (await args.task({ req })).output,
  } as never)
  assert.ok(queued[0])
  assert.equal(queued[0].overrideAccess, true)
  assert.ok(queued[0])
  assert.equal(queued[0].req, req)
  assert.ok(queued[0])
  assert.equal((queued[0].input as { resume: { parentJob: number } }).resume.parentJob, 1)
})
