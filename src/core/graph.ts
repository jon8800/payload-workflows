import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from './types'

export function nodeMap(graph: WorkflowGraph): Map<string, WorkflowNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]))
}

export function outgoingEdges(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
  return graph.edges.filter((edge) => edge.source === nodeId)
}

export function incomingEdges(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
  return graph.edges.filter((edge) => edge.target === nodeId)
}

/**
 * Orders nodes so every edge points forward (Kahn's algorithm). Returns the order, plus the ids of
 * nodes that sit on a cycle and could not be ordered. Ties keep the stored node order, so the
 * result is stable.
 */
export function topologicalSort(graph: WorkflowGraph): { cyclic: string[]; order: string[] } {
  const ids = new Set(graph.nodes.map((node) => node.id))
  const inDegree = new Map<string, number>([...ids].map((id) => [id, 0]))
  const edges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
  for (const edge of edges) inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)

  const order: string[] = []
  const ready = graph.nodes.filter((node) => inDegree.get(node.id) === 0).map((node) => node.id)
  while (ready.length > 0) {
    const id = ready.shift()!
    order.push(id)
    for (const edge of edges) {
      if (edge.source !== id) continue
      const remaining = inDegree.get(edge.target)! - 1
      inDegree.set(edge.target, remaining)
      if (remaining === 0) ready.push(edge.target)
    }
  }
  const placed = new Set(order)
  return { cyclic: graph.nodes.map((node) => node.id).filter((id) => !placed.has(id)), order }
}

function reach(graph: WorkflowGraph, start: string, direction: 'down' | 'up'): Set<string> {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length > 0) {
    const id = stack.pop()!
    for (const edge of graph.edges) {
      const [from, to] = direction === 'down' ? [edge.source, edge.target] : [edge.target, edge.source]
      if (from !== id || seen.has(to)) continue
      seen.add(to)
      stack.push(to)
    }
  }
  seen.delete(start)
  return seen
}

/** Every node with a path to `nodeId`. */
export function ancestors(graph: WorkflowGraph, nodeId: string): Set<string> {
  return reach(graph, nodeId, 'up')
}

/** Every node reachable from `nodeId`. */
export function descendants(graph: WorkflowGraph, nodeId: string): Set<string> {
  return reach(graph, nodeId, 'down')
}

const COLUMN_GAP = 300
const ROW_GAP = 170

/**
 * Places nodes in rows by their longest distance from a root, top to bottom, and centres each row.
 * Used by the editor's "Tidy up" button and by the run viewer for code workflows.
 */
export function autoLayout(graph: WorkflowGraph): WorkflowGraph {
  const { cyclic, order } = topologicalSort(graph)
  const depth = new Map<string, number>()
  for (const id of order) {
    const parents = incomingEdges(graph, id).map((edge) => depth.get(edge.source) ?? 0)
    depth.set(id, parents.length > 0 ? Math.max(...parents) + 1 : 0)
  }
  const deepest = Math.max(0, ...depth.values())
  for (const id of cyclic) depth.set(id, deepest + 1)

  const rows = new Map<number, string[]>()
  for (const node of graph.nodes) {
    const row = depth.get(node.id) ?? 0
    rows.set(row, [...(rows.get(row) ?? []), node.id])
  }
  const position = new Map<string, { x: number; y: number }>()
  for (const [row, ids] of rows) {
    // Keep false-branch targets to the right of true-branch targets.
    ids.sort((a, b) => branchRank(graph, a) - branchRank(graph, b))
    ids.forEach((id, index) => {
      position.set(id, { x: (index - (ids.length - 1) / 2) * COLUMN_GAP, y: row * ROW_GAP })
    })
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, position: position.get(node.id) ?? node.position })),
  }
}

function branchRank(graph: WorkflowGraph, id: string): number {
  const edge = incomingEdges(graph, id)[0]
  if (edge?.sourceHandle === 'true') return 0
  if (edge?.sourceHandle === 'false') return 2
  return 1
}
