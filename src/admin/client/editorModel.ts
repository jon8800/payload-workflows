import type { Edge, Node } from '@xyflow/react'

import type { TaskCatalogue, WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeType } from '../../core/types'

export type FlowNode = Node<WorkflowNode['data'] & Record<string, unknown>, WorkflowNodeType>

export type PaletteItem = { kind: 'condition' | 'delay' } | { kind: 'task'; task: string }

export const DRAG_TYPE = 'application/x-payload-workflows'

export function emptyEditorGraph(): WorkflowGraph {
  return { edges: [], nodes: [{ data: { kind: 'manual' }, id: 'trigger', position: { x: 0, y: 0 }, type: 'trigger' }] }
}

export function toFlowNodes(graph: WorkflowGraph): FlowNode[] {
  return graph.nodes.map((node) => ({ ...node, data: node.data as FlowNode['data'] }))
}

export function toFlowEdges(graph: WorkflowGraph): Edge[] {
  return graph.edges.map((edge) => ({ ...edge, sourceHandle: edge.sourceHandle ?? undefined }))
}

/** The stored graph: only the fields we own, positions rounded, no React Flow state. */
export function toGraph(nodes: FlowNode[], edges: Edge[]): WorkflowGraph {
  return {
    edges: edges.map((edge) => {
      const stored: WorkflowEdge = { id: edge.id, source: edge.source, target: edge.target }
      if (edge.sourceHandle === 'true' || edge.sourceHandle === 'false') stored.sourceHandle = edge.sourceHandle
      return stored
    }),
    nodes: nodes.map(
      (node) =>
        ({
          data: node.data,
          id: node.id,
          position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
          type: node.type,
        }) as WorkflowNode,
    ),
  }
}

/** A readable, unique node id such as `sendEmail2`. Ids appear in references like `{{steps.sendEmail2.output}}`. */
export function nextNodeId(base: string, taken: Set<string>): string {
  const clean = base.replace(/[^\w]/g, '') || 'step'
  for (let n = 1; ; n++) {
    const id = `${clean}${n}`
    if (!taken.has(id)) return id
  }
}

export function createNode(item: PaletteItem, position: { x: number; y: number }, taken: Set<string>): FlowNode {
  if (item.kind === 'task') {
    return { data: { input: {}, task: item.task }, id: nextNodeId(item.task, taken), position, type: 'task' }
  }
  if (item.kind === 'condition') {
    return {
      data: { match: 'all', rules: [{ left: '', operator: 'equals', right: '' }] },
      id: nextNodeId('condition', taken),
      position,
      type: 'condition',
    }
  }
  return { data: { amount: 5, unit: 'minutes' }, id: nextNodeId('delay', taken), position, type: 'delay' }
}

export function paletteLabel(item: PaletteItem, catalogue: TaskCatalogue): string {
  if (item.kind === 'task') return catalogue[item.task]?.label ?? item.task
  return item.kind === 'condition' ? 'Condition' : 'Delay'
}
