import { describe, expect, it } from 'vitest'

import type { JobLogEntry } from './runs'
import type { TaskCatalogue, WorkflowGraph, WorkflowNode } from './types'

import { ancestors, autoLayout, topologicalSort } from './graph'
import { compare, evaluateRules } from './rules'
import { jobState, logToAttempts, takenEdges, visualNodeRuns } from './runs'
import { findReferences, readPath, resolveTemplates } from './template'
import { validateGraph } from './validate'
import { coerceInput, walkGraph } from './walk'

const at = { x: 0, y: 0 }
const trigger = (data: Partial<Extract<WorkflowNode, { type: 'trigger' }>['data']> = {}): WorkflowNode => ({
  data: { kind: 'manual', ...data },
  id: 'trigger',
  position: at,
  type: 'trigger',
})
const task = (id: string, slug = 'sendEmail', input: Record<string, unknown> = { to: 'a@b.c' }): WorkflowNode => ({
  data: { input, task: slug },
  id,
  position: at,
  type: 'task',
})
const condition = (id: string, left: string, right: string): WorkflowNode => ({
  data: { match: 'all', rules: [{ left, operator: 'equals', right }] },
  id,
  position: at,
  type: 'condition',
})
const edge = (source: string, target: string, sourceHandle?: 'false' | 'true') => ({
  id: `${source}-${sourceHandle ?? 'out'}-${target}`,
  source,
  sourceHandle,
  target,
})

const catalogue: TaskCatalogue = {
  sendEmail: {
    fields: [
      { label: 'To', name: 'to', required: true, type: 'email' },
      { label: 'Subject', name: 'subject', required: false, type: 'text' },
    ],
    label: 'Send email',
    outputs: ['messageId'],
    slug: 'sendEmail',
  },
}

describe('templates', () => {
  const context = {
    steps: { a: { output: { count: 3, items: [{ name: 'first' }], tags: ['x'] } } },
    trigger: { doc: { status: 'published', title: 'Hello' } },
  }

  it('keeps the type of a value when the whole string is one template', () => {
    expect(resolveTemplates('{{steps.a.output.count}}', context)).toBe(3)
    expect(resolveTemplates('{{ steps.a.output.tags }}', context)).toEqual(['x'])
  })

  it('interpolates templates inside text', () => {
    expect(resolveTemplates('New post: {{trigger.doc.title}} ({{steps.a.output.count}})', context)).toBe('New post: Hello (3)')
    expect(resolveTemplates('Missing: [{{trigger.doc.nope}}]', context)).toBe('Missing: []')
  })

  it('reads array indexes in dot and bracket form', () => {
    expect(readPath(context, 'steps.a.output.items[0].name')).toBe('first')
    expect(readPath(context, 'steps.a.output.items.0.name')).toBe('first')
  })

  it('resolves nested objects and arrays', () => {
    expect(resolveTemplates({ list: ['{{trigger.doc.title}}'], n: 1 }, context)).toEqual({ list: ['Hello'], n: 1 })
  })

  it('refuses prototype keys and unknown roots, and never runs code', () => {
    expect(readPath(context, 'trigger.__proto__')).toBeUndefined()
    expect(readPath(context, 'trigger.constructor.name')).toBeUndefined()
    expect(readPath({ process }, 'process.env')).toBeUndefined()
    expect(resolveTemplates('{{ trigger.doc.title.toUpperCase() }}', context)).toBeUndefined()
    expect(readPath(context, 'trigger.doc.title.length')).toBeUndefined()
  })

  it('finds references', () => {
    expect(findReferences({ a: 'x {{trigger.doc.id}} y {{ steps.b.output }}' })).toEqual(['trigger.doc.id', 'steps.b.output'])
  })
})

describe('rules', () => {
  it('compares loosely across numbers and text', () => {
    expect(compare(3, 'equals', '3')).toBe(true)
    expect(compare('10', 'gt', '9')).toBe(true)
    expect(compare('abc', 'gt', 1)).toBe(false)
    expect(compare(['a', 'b'], 'contains', 'b')).toBe(true)
    expect(compare('hello world', 'notContains', 'xyz')).toBe(true)
    expect(compare('', 'exists', undefined)).toBe(false)
    expect(compare('2026-01-02', 'gt', '2026-01-01')).toBe(true)
  })

  it('combines rules with all and any', () => {
    const context = { trigger: { doc: { status: 'draft', views: 5 } } }
    const rules = [
      { left: '{{trigger.doc.status}}', operator: 'equals' as const, right: 'published' },
      { left: '{{trigger.doc.views}}', operator: 'gte' as const, right: '5' },
    ]
    expect(evaluateRules({ match: 'all', rules }, context).passed).toBe(false)
    expect(evaluateRules({ match: 'any', rules }, context).passed).toBe(true)
    expect(evaluateRules(undefined, context).passed).toBe(true)
  })
})

describe('graph', () => {
  it('detects cycles', () => {
    const graph: WorkflowGraph = {
      edges: [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'a')],
      nodes: [trigger(), task('a'), task('b')],
    }
    expect(topologicalSort(graph).cyclic.toSorted()).toEqual(['a', 'b'])
    expect(validateGraph(graph, catalogue).some((issue) => issue.message.includes('loop'))).toBe(true)
  })

  it('lays out nodes in rows by depth', () => {
    const graph = autoLayout({
      edges: [edge('trigger', 'c'), edge('c', 'yes', 'true'), edge('c', 'no', 'false')],
      nodes: [trigger(), condition('c', '1', '1'), task('yes'), task('no')],
    })
    const y = Object.fromEntries(graph.nodes.map((n) => [n.id, n.position]))
    expect(y.c!.y).toBeGreaterThan(y.trigger!.y)
    expect(y.yes!.y).toBe(y.no!.y)
    expect(y.yes!.x).toBeLessThan(y.no!.x)
  })
})

describe('validateGraph', () => {
  it('accepts a valid graph', () => {
    const graph: WorkflowGraph = {
      edges: [edge('trigger', 'a'), edge('a', 'b')],
      nodes: [trigger(), task('a'), task('b', 'sendEmail', { to: 'x@y.z', subject: '{{steps.a.output.messageId}}' })],
    }
    expect(validateGraph(graph, catalogue)).toEqual([])
  })

  it('needs exactly one trigger', () => {
    expect(validateGraph({ edges: [], nodes: [task('a')] }, catalogue)[0]!.message).toMatch(/Add a trigger/)
    const two = validateGraph({ edges: [], nodes: [trigger(), { ...trigger(), id: 't2' }] }, catalogue)
    expect(two.some((issue) => issue.nodeId === 't2' && issue.message.includes('only one trigger'))).toBe(true)
  })

  it('reports missing required inputs, unknown tasks and unconnected steps', () => {
    const graph: WorkflowGraph = {
      edges: [edge('trigger', 'a')],
      nodes: [trigger(), task('a', 'sendEmail', {}), task('b', 'nope'), task('c')],
    }
    const messages = validateGraph(graph, catalogue).map((issue) => `${issue.nodeId}: ${issue.message}`)
    expect(messages).toContain('a: "To" is required.')
    expect(messages).toContain('b: The task "nope" is not registered.')
    expect(messages).toContain('c: This step is not connected to the trigger, so it never runs.')
  })

  it('reports references to steps that do not run earlier', () => {
    const graph: WorkflowGraph = {
      edges: [edge('trigger', 'a'), edge('trigger', 'b')],
      nodes: [trigger(), task('a', 'sendEmail', { to: '{{steps.b.output.messageId}}' }), task('b'), ],
    }
    const issues = validateGraph(graph, catalogue)
    expect(issues).toContainEqual({ message: '"{{steps.b.output.messageId}}" points at a step that does not run before this one.', nodeId: 'a' })
    expect(ancestors(graph, 'a').has('b')).toBe(false)
  })

  it('checks trigger settings', () => {
    const schedule = validateGraph({ edges: [], nodes: [trigger({ cron: 'every day', kind: 'schedule' })] }, catalogue)
    expect(schedule[0]!.message).toMatch(/cron/)
    const collection = validateGraph(
      { edges: [], nodes: [trigger({ collection: 'pages', kind: 'collection', operations: ['create'] })] },
      catalogue,
      { collections: ['posts'] },
    )
    expect(collection[0]!.message).toMatch(/not set up to start workflows/)
  })

  it('needs every path after a Delay to go through it', () => {
    const graph: WorkflowGraph = {
      edges: [edge('trigger', 'd'), edge('d', 'a'), edge('trigger', 'a')],
      nodes: [trigger(), { data: { amount: 1, unit: 'hours' }, id: 'd', position: at, type: 'delay' }, task('a')],
    }
    expect(validateGraph(graph, catalogue).some((issue) => issue.nodeId === 'a' && issue.message.includes('Delay'))).toBe(true)
  })
})

describe('walkGraph', () => {
  const graph: WorkflowGraph = {
    edges: [
      edge('trigger', 'check'),
      edge('check', 'yes', 'true'),
      edge('check', 'no', 'false'),
      edge('yes', 'after'),
      edge('no', 'after'),
    ],
    nodes: [trigger(), condition('check', '{{trigger.status}}', 'published'), task('yes'), task('no'), task('after')],
  }

  async function run(status: string, startAfter?: string) {
    const context = { steps: {}, trigger: { status }, workflow: { id: '1' } }
    const { ran } = await walkGraph({
      context,
      graph,
      startAfter,
      runNode: async (node, ctx) => {
        if (node.type === 'condition') {
          const passed = evaluateRules(node.data, ctx).passed
          return { branch: passed ? 'true' : 'false', output: { passed } }
        }
        return { output: { ran: node.id } }
      },
    })
    return { context, ran }
  }

  it('follows the true branch and joins afterwards', async () => {
    const { context, ran } = await run('published')
    expect(ran).toEqual(['check', 'yes', 'after'])
    expect(context.steps).toHaveProperty('yes')
    expect(context.steps).not.toHaveProperty('no')
  })

  it('follows the false branch', async () => {
    expect((await run('draft')).ran).toEqual(['check', 'no', 'after'])
  })

  it('resumes after a given node', async () => {
    expect((await run('draft', 'yes')).ran).toEqual(['after'])
  })

  it('stops a branch at a node that returns stop', async () => {
    const delayed: WorkflowGraph = {
      edges: [edge('trigger', 'd'), edge('d', 'later'), edge('trigger', 'now')],
      nodes: [trigger(), { data: { amount: 1, unit: 'days' }, id: 'd', position: at, type: 'delay' }, task('later'), task('now')],
    }
    const { ran } = await walkGraph({
      context: { steps: {}, trigger: {}, workflow: { id: '1' } },
      graph: delayed,
      runNode: async (node) => ({ output: {}, stop: node.type === 'delay' }),
    })
    expect(ran.toSorted()).toEqual(['d', 'now'])
  })
})

describe('coerceInput', () => {
  it('converts text to the field types and drops empty values', () => {
    const fields = [
      { label: 'N', name: 'n', required: false, type: 'number' as const },
      { label: 'B', name: 'b', required: false, type: 'checkbox' as const },
      { label: 'J', name: 'j', required: false, type: 'json' as const },
      { label: 'T', name: 't', required: false, type: 'text' as const },
    ]
    expect(coerceInput(fields, { b: 'true', j: '{"a":1}', n: '42', t: '' })).toEqual({ b: true, j: { a: 1 }, n: 42 })
    expect(coerceInput(fields, { n: 7, extra: 'kept' })).toEqual({ extra: 'kept', n: 7 })
  })
})

const entry = (taskID: string, state: 'failed' | 'succeeded', minute: number): JobLogEntry => ({
  completedAt: `2026-01-01T00:0${minute}:01.000Z`,
  executedAt: `2026-01-01T00:0${minute}:00.000Z`,
  state,
  taskID,
  taskSlug: 'sendEmail',
})

describe('logToAttempts', () => {

  it('returns no attempts for an empty log', () => {
    expect(logToAttempts([])).toEqual([])
    expect(logToAttempts(undefined)).toEqual([])
  })

  it('makes one attempt for a run without failures', () => {
    const attempts = logToAttempts([entry('a', 'succeeded', 1), entry('b', 'succeeded', 2)])
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.failed).toBe(false)
    expect(attempts[0]!.entries.map((e) => e.log.taskID)).toEqual(['a', 'b'])
  })

  it('splits retries and marks reused outputs as restored', () => {
    const attempts = logToAttempts([
      entry('a', 'succeeded', 1),
      entry('b', 'failed', 2),
      entry('b', 'failed', 3),
      entry('b', 'succeeded', 4),
      entry('c', 'succeeded', 5),
    ])
    expect(attempts.map((a) => a.failed)).toEqual([true, true, false])
    expect(attempts[1]!.entries.map((e) => [e.log.taskID, e.restored])).toEqual([
      ['a', true],
      ['b', false],
    ])
    expect(attempts[2]!.entries.map((e) => [e.log.taskID, e.log.state, e.restored])).toEqual([
      ['a', 'succeeded', true],
      ['b', 'succeeded', false],
      ['c', 'succeeded', false],
    ])
  })

  it('does not add an empty attempt when the log ends with a failure', () => {
    const attempts = logToAttempts([entry('a', 'succeeded', 1), entry('b', 'failed', 2)])
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.failed).toBe(true)
  })
})

describe('run status', () => {
  it('reads the job state', () => {
    expect(jobState({ completedAt: 'x', id: 1 })).toBe('completed')
    expect(jobState({ error: { cancelled: true }, hasError: true, id: 1 })).toBe('cancelled')
    expect(jobState({ hasError: true, id: 1 })).toBe('failed')
    expect(jobState({ id: 1, processing: true })).toBe('running')
    expect(jobState({ id: 1, totalTried: 1 })).toBe('retrying')
    expect(jobState({ id: 1, waitUntil: '2999-01-01T00:00:00.000Z' })).toBe('scheduled')
    expect(jobState({ id: 1 })).toBe('queued')
  })

  it('marks the path taken, skipped branches and failures', () => {
    const graph: WorkflowGraph = {
      edges: [edge('trigger', 'check'), edge('check', 'yes', 'true'), edge('check', 'no', 'false')],
      nodes: [trigger(), condition('check', '1', '1'), task('yes'), task('no')],
    }
    const log: JobLogEntry[] = [
      { completedAt: 'b', executedAt: 'a', output: { branch: 'true' }, state: 'succeeded', taskID: 'check', taskSlug: 'inline' },
      { completedAt: 'b', executedAt: 'a', state: 'succeeded', taskID: 'yes', taskSlug: 'sendEmail' },
    ]
    const input = { graph, trigger: {}, workflowId: '1' }
    const runs = visualNodeRuns({ attempt: logToAttempts(log)[0], input, isLatest: true, state: 'completed' })
    expect(Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, run.status]))).toEqual({
      check: 'succeeded',
      no: 'skipped',
      trigger: 'succeeded',
      yes: 'succeeded',
    })
    expect([...takenEdges(graph, runs)].toSorted()).toEqual(['check-true-yes', 'trigger-out-check'])

    const failedLog: JobLogEntry[] = [{ ...log[0]! }, { ...log[1]!, state: 'failed' }]
    const failed = visualNodeRuns({ attempt: logToAttempts(failedLog)[0], input, isLatest: true, state: 'failed' })
    expect(failed.yes!.status).toBe('failed')
    expect(failed.no!.status).toBe('notReached')
  })
})
