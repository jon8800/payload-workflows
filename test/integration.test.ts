import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, createPayloadRequest, getPayload, type Payload, type TaskConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { JobLogEntry, JobSnapshot } from '../src/core/runs'
import type { WorkflowGraph } from '../src/core/types'

import { logToAttempts, visualNodeRuns, jobState } from '../src/core/runs'
import { queueDueWorkflows, queueWorkflowRun, RUN_WORKFLOW_SLUG, workflowsPlugin } from '../src/index'

let payload: Payload
const sent: { subject: string; to: string }[] = []
const flakyCalls: Record<string, number> = {}

const tasks: TaskConfig[] = [
  {
    slug: 'createNote',
    inputSchema: [{ name: 'text', type: 'text', required: true }],
    outputSchema: [{ name: 'id', type: 'text' }],
    handler: async ({ input, req }) => {
      const note = (await req.payload.create({ collection: 'notes' as never, data: { text: (input as { text: string }).text } as never, req, overrideAccess: true })) as unknown as { id: number }
      return { output: { id: String(note.id) } }
    },
  },
  {
    slug: 'sendEmail',
    inputSchema: [
      { name: 'to', type: 'email', required: true },
      { name: 'subject', type: 'text' },
      { name: 'urgent', type: 'checkbox' },
    ],
    outputSchema: [{ name: 'messageId', type: 'text' }],
    handler: async ({ input }) => {
      const { subject, to } = input as { subject: string; to: string }
      sent.push({ subject, to })
      return { output: { messageId: `msg-${sent.length}` } }
    },
  },
  {
    slug: 'flaky',
    inputSchema: [{ name: 'key', type: 'text', required: true }, { name: 'failTimes', type: 'number' }],
    outputSchema: [{ name: 'calls', type: 'number' }],
    retries: 2,
    handler: async ({ input }) => {
      const { failTimes, key } = input as { failTimes?: number; key: string }
      flakyCalls[key] = (flakyCalls[key] ?? 0) + 1
      if (flakyCalls[key]! <= (failTimes ?? 1)) throw new Error(`Flaky failure ${flakyCalls[key]}`)
      return { output: { calls: flakyCalls[key] } }
    },
  },
] as TaskConfig[]

const at = { x: 0, y: 0 }

function branchingGraph(key: string): WorkflowGraph {
  return {
    edges: [
      { id: 'e1', source: 'trigger', target: 'note' },
      { id: 'e2', source: 'note', target: 'check' },
      { id: 'e3', source: 'check', sourceHandle: 'true', target: 'flaky' },
      { id: 'e4', source: 'check', sourceHandle: 'false', target: 'quiet' },
      { id: 'e5', source: 'flaky', target: 'email' },
    ],
    nodes: [
      { data: { kind: 'manual', sampleData: { priority: 'high' } }, id: 'trigger', position: at, type: 'trigger' },
      { data: { input: { text: 'Note for {{trigger.data.priority}}' }, task: 'createNote' }, id: 'note', position: at, type: 'task' },
      {
        data: { match: 'all', rules: [{ left: '{{trigger.data.priority}}', operator: 'equals', right: 'high' }] },
        id: 'check',
        position: at,
        type: 'condition',
      },
      { data: { input: { failTimes: '1', key }, task: 'flaky' }, id: 'flaky', position: at, type: 'task' },
      {
        data: { input: { subject: 'Note {{steps.note.output.id}} after {{steps.flaky.output.calls}} calls', to: 'ops@example.com', urgent: 'true' }, task: 'sendEmail' },
        id: 'email',
        position: at,
        type: 'task',
      },
      { data: { input: { to: 'quiet@example.com' }, task: 'sendEmail' }, id: 'quiet', position: at, type: 'task' },
    ],
  }
}

async function createWorkflow(title: string, graph: WorkflowGraph, enabled = true) {
  return payload.create({ collection: 'workflows', data: { enabled, graph, title } as never, overrideAccess: true })
}

async function getJob(id: number | string): Promise<JobSnapshot> {
  return (await payload.findByID({ collection: 'payload-jobs', depth: 0, id, overrideAccess: true })) as unknown as JobSnapshot
}

async function runQueue() {
  await payload.jobs.run({ queue: 'workflows', silent: true, overrideAccess: true })
}

beforeAll(async () => {
  payload = await getPayload({
    config: buildConfig({
      collections: [
        { slug: 'users', auth: true, fields: [] },
        { slug: 'notes', fields: [{ name: 'text', type: 'text' }] },
        { slug: 'posts', fields: [{ name: 'title', type: 'text' }, { name: 'status', type: 'text' }] },
      ],
      db: sqliteAdapter({ client: { url: 'file::memory:' }, push: true }),
      jobs: { tasks },
      plugins: [workflowsPlugin({ autoRun: false, collections: ['posts'] })],
      secret: 'payload-workflows-integration',
      typescript: { autoGenerate: false },
    }),
  })
})

afterAll(async () => {
  await payload?.destroy()
})

describe('visual workflow runs', () => {
  it('runs a branch, retries a failing task, and reuses outputs of steps that already succeeded', async () => {
    const workflow = await createWorkflow('Branching', branchingGraph('retry'))
    const req = await createPayloadRequest({ payload })
    const job = await queueWorkflowRun({ overrideAccess: true, req, trigger: { data: { priority: 'high' }, kind: 'manual' }, workflow: workflow as never })

    await runQueue()
    let snapshot = await getJob(job.id)
    expect(jobState(snapshot)).toBe('retrying')
    expect(snapshot.log?.map((e) => [e.taskID, e.state])).toEqual([
      ['note', 'succeeded'],
      ['check', 'succeeded'],
      ['flaky', 'failed'],
    ])

    await runQueue()
    snapshot = await getJob(job.id)
    expect(jobState(snapshot)).toBe('completed')

    // The note was created once: the retry reused the first attempt's output.
    const notes = await payload.find({ collection: 'notes' as never, where: { text: { equals: 'Note for high' } }, overrideAccess: true })
    expect(notes.totalDocs).toBe(1)
    expect(sent.at(-1)).toEqual({ subject: `Note ${(notes.docs[0] as unknown as { id: number }).id} after 2 calls`, to: 'ops@example.com' })

    const email = snapshot.log!.find((e) => e.taskID === 'email')!
    expect(email.input).toEqual({ subject: `Note ${(notes.docs[0] as unknown as { id: number }).id} after 2 calls`, to: 'ops@example.com', urgent: true })

    const attempts = logToAttempts(snapshot.log as JobLogEntry[])
    expect(attempts).toHaveLength(2)
    const runs = visualNodeRuns({ attempt: attempts[1], input: snapshot.input as never, isLatest: true, state: 'completed' })
    expect(Object.fromEntries(Object.entries(runs).map(([id, r]) => [id, r.status]))).toEqual({
      check: 'restored',
      email: 'succeeded',
      flaky: 'succeeded',
      note: 'restored',
      quiet: 'skipped',
      trigger: 'succeeded',
    })
  })

  it('takes the false branch', async () => {
    const workflow = await createWorkflow('Low priority', branchingGraph('low'))
    const req = await createPayloadRequest({ payload })
    const job = await queueWorkflowRun({ overrideAccess: true, req, trigger: { data: { priority: 'low' }, kind: 'manual' }, workflow: workflow as never })
    await runQueue()
    const snapshot = await getJob(job.id)
    expect(jobState(snapshot)).toBe('completed')
    expect(snapshot.log?.map((e) => e.taskID)).toEqual(['note', 'check', 'quiet'])
    expect(snapshot.log?.find((e) => e.taskID === 'check')?.output).toMatchObject({ branch: 'false', result: false })
  })

  it('stops with an error once a task runs out of retries', async () => {
    const workflow = await createWorkflow('Always fails', branchingGraph('fatal'))
    const graph = branchingGraph('fatal')
    const flaky = graph.nodes.find((n) => n.id === 'flaky')!
    if (flaky.type === 'task') flaky.data.input.failTimes = '99'
    await payload.update({ collection: 'workflows', data: { graph } as never, id: workflow.id, overrideAccess: true })
    const updated = await payload.findByID({ collection: 'workflows', id: workflow.id, overrideAccess: true })
    const req = await createPayloadRequest({ payload })
    const job = await queueWorkflowRun({ overrideAccess: true, req, trigger: { data: { priority: 'high' }, kind: 'manual' }, workflow: updated as never })

    for (let i = 0; i < 4; i++) await runQueue()
    const snapshot = await getJob(job.id)
    expect(jobState(snapshot)).toBe('failed')
    expect(flakyCalls.fatal).toBe(3)
    expect(logToAttempts(snapshot.log as JobLogEntry[]).map((a) => a.failed)).toEqual([true, true, true])
  })
})

describe('triggers', () => {
  it('starts enabled workflows on matching collection events only', async () => {
    const graph: WorkflowGraph = {
      edges: [{ id: 'e1', source: 'trigger', target: 'email' }],
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
        { data: { input: { subject: 'Published: {{trigger.doc.title}}', to: 'editor@example.com' }, task: 'sendEmail' }, id: 'email', position: at, type: 'task' },
      ],
    }
    const workflow = await createWorkflow('On publish', graph)
    expect(workflow).toMatchObject({ triggerCollection: 'posts', triggerKind: 'collection' })

    const countRuns = async () =>
      (await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { workflowSlug: { equals: RUN_WORKFLOW_SLUG } } }))
        .docs.filter((job) => (job.input as { workflowId?: string }).workflowId === String(workflow.id)).length

    await payload.create({ collection: 'posts', data: { status: 'draft', title: 'Draft' }, overrideAccess: true })
    expect(await countRuns()).toBe(0)
    await payload.create({ collection: 'posts', data: { status: 'published', title: 'Launch' }, overrideAccess: true })
    expect(await countRuns()).toBe(1)

    await runQueue()
    expect(sent.at(-1)).toEqual({ subject: 'Published: Launch', to: 'editor@example.com' })
  })

  it('queues schedule workflows when they are due, and moves the next run on', async () => {
    const graph: WorkflowGraph = {
      edges: [{ id: 'e1', source: 'trigger', target: 'email' }],
      nodes: [
        { data: { cron: '0 9 * * *', kind: 'schedule' }, id: 'trigger', position: at, type: 'trigger' },
        { data: { input: { subject: 'Daily at {{trigger.scheduledFor}}', to: 'daily@example.com' }, task: 'sendEmail' }, id: 'email', position: at, type: 'task' },
      ],
    }
    const workflow = (await createWorkflow('Daily', graph)) as unknown as { id: number; nextRunAt: string }
    expect(workflow.nextRunAt).toBeTruthy()

    const req = await createPayloadRequest({ payload })
    expect(await queueDueWorkflows(req, new Date(Date.parse(workflow.nextRunAt) - 1000))).toBe(0)
    const later = new Date(Date.parse(workflow.nextRunAt) + 1000)
    expect(await queueDueWorkflows(req, later)).toBe(1)
    const after = (await payload.findByID({ collection: 'workflows', id: workflow.id, overrideAccess: true })) as unknown as { nextRunAt: string }
    expect(Date.parse(after.nextRunAt)).toBe(Date.parse(workflow.nextRunAt) + 86_400_000)

    await runQueue()
    expect(sent.at(-1)?.to).toBe('daily@example.com')
  })

  it('refuses to enable an invalid workflow', async () => {
    const graph: WorkflowGraph = {
      edges: [{ id: 'e1', source: 'trigger', target: 'email' }],
      nodes: [
        { data: { kind: 'manual' }, id: 'trigger', position: at, type: 'trigger' },
        { data: { input: {}, task: 'sendEmail' }, id: 'email', position: at, type: 'task' },
      ],
    }
    type PayloadError = { data?: { errors?: { message: string }[] } }
    const error = (await createWorkflow('Invalid', graph).catch((err: unknown) => err)) as PayloadError
    expect(error.data?.errors?.[0]?.message).toMatch(/"To" is required/)
    await expect(createWorkflow('Invalid but off', graph, false)).resolves.toBeTruthy()
  })
})

describe('delay', () => {
  it('continues the run in a new job after the delay', async () => {
    const graph: WorkflowGraph = {
      edges: [
        { id: 'e1', source: 'trigger', target: 'first' },
        { id: 'e2', source: 'first', target: 'wait' },
        { id: 'e3', source: 'wait', target: 'second' },
      ],
      nodes: [
        { data: { kind: 'manual' }, id: 'trigger', position: at, type: 'trigger' },
        { data: { input: { subject: 'first', to: 'delay@example.com' }, task: 'sendEmail' }, id: 'first', position: at, type: 'task' },
        { data: { amount: 1, unit: 'seconds' }, id: 'wait', position: at, type: 'delay' },
        { data: { input: { subject: 'second after {{steps.first.output.messageId}}', to: 'delay@example.com' }, task: 'sendEmail' }, id: 'second', position: at, type: 'task' },
      ],
    }
    const workflow = await createWorkflow('Delayed', graph)
    const req = await createPayloadRequest({ payload })
    const job = await queueWorkflowRun({ overrideAccess: true, req, trigger: { kind: 'manual' }, workflow: workflow as never })
    await runQueue()

    const first = await getJob(job.id)
    expect(jobState(first)).toBe('completed')
    const wait = first.log!.find((e) => e.taskID === 'wait')!
    const continuedIn = (wait.output as { continuedIn: number }).continuedIn
    expect(continuedIn).toBeTruthy()
    const firstMessage = (first.log!.find((e) => e.taskID === 'first')!.output as { messageId: string }).messageId

    await runQueue()
    expect(jobState(await getJob(continuedIn))).toBe('scheduled')

    await new Promise((resolve) => setTimeout(resolve, 1200))
    await runQueue()
    const second = await getJob(continuedIn)
    expect(jobState(second)).toBe('completed')
    expect(second.log?.map((e) => e.taskID)).toEqual(['second'])
    expect(sent.at(-1)).toEqual({ subject: `second after ${firstMessage}`, to: 'delay@example.com' })
  })
})
