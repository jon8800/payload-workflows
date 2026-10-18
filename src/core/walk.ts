import type { BranchHandle, DelayUnit, RunContext, TaskInputField, WorkflowGraph, WorkflowNode } from './types'

import { incomingEdges, outgoingEdges, topologicalSort } from './graph'

export type StepResult = {
  /** Condition nodes: the branch to follow. */
  branch?: BranchHandle
  output: unknown
  /** True when the run must not continue past this node in this job (a Delay). */
  stop?: boolean
}

export type RunNode = (node: Exclude<WorkflowNode, { type: 'trigger' }>, context: RunContext) => Promise<StepResult>

/**
 * Walks a workflow graph in topological order. A node runs when at least one of its incoming
 * connections is active. The trigger (or, for a resumed run, the node to resume from) activates
 * all its outgoing connections. A condition activates only the connections of the branch it
 * returns. Nodes that are never activated are skipped.
 *
 * The walk itself has no side effects: `runNode` does the work and records its output.
 */
export async function walkGraph(args: {
  context: RunContext
  graph: WorkflowGraph
  runNode: RunNode
  /** Resume after this node instead of starting at the trigger. */
  startAfter?: string
}): Promise<{ ran: string[] }> {
  const { context, graph, runNode, startAfter } = args
  const { cyclic, order } = topologicalSort(graph)
  if (cyclic.length > 0) throw new Error('The workflow contains a loop, so it cannot run.')

  const root = startAfter ?? graph.nodes.find((node) => node.type === 'trigger')?.id
  if (!root) throw new Error('The workflow has no trigger.')

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  const active = new Set<string>()
  const ran: string[] = []

  for (const edge of outgoingEdges(graph, root)) active.add(edge.id)

  for (const id of order) {
    const node = nodes.get(id)!
    if (id === root || node.type === 'trigger') continue
    if (!incomingEdges(graph, id).some((edge) => active.has(edge.id))) continue

    const result = await runNode(node, context)
    context.steps[id] = { output: result.output }
    ran.push(id)
    if (result.stop) continue

    for (const edge of outgoingEdges(graph, id)) {
      if (node.type === 'condition' && edge.sourceHandle !== result.branch) continue
      active.add(edge.id)
    }
  }
  return { ran }
}

const UNIT_MS: Record<DelayUnit, number> = {
  days: 86_400_000,
  hours: 3_600_000,
  minutes: 60_000,
  seconds: 1_000,
}

export function delayToMs(amount: number, unit: DelayUnit): number {
  return Math.max(0, amount) * UNIT_MS[unit]
}

/**
 * Turns resolved template values into the types the task's `inputSchema` expects. The editor
 * stores every value as text (so it can hold templates), so "42" becomes 42 for a number field.
 * Empty values are left out, so the task sees a missing key rather than an empty string.
 */
export function coerceInput(fields: TaskInputField[] | undefined, input: Record<string, unknown>): Record<string, unknown> {
  const byName = new Map((fields ?? []).map((field) => [field.name, field]))
  const result: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(input)) {
    const field = byName.get(name)
    if (value === undefined || value === null || value === '') {
      if (field?.type === 'checkbox') result[name] = false
      continue
    }
    if (!field || typeof value !== 'string') {
      result[name] = field?.type === 'checkbox' ? value === true : value
      continue
    }
    switch (field.type) {
      case 'number': {
        const number = Number(value)
        result[name] = Number.isFinite(number) ? number : value
        break
      }
      case 'checkbox':
        result[name] = value.trim().toLowerCase() === 'true'
        break
      case 'json':
        try {
          result[name] = JSON.parse(value)
        } catch {
          result[name] = value
        }
        break
      default:
        result[name] = value
    }
  }
  return result
}
