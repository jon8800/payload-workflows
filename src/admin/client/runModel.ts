import type { Attempt, AttemptEntry, JobSnapshot, JobState, NodeRunStatus } from '../../core/runs'
import type { BranchHandle, VisualRunInput, WorkflowNodeType } from '../../core/types'
import type { NodeCardProps } from './NodeCard'
import type { TaskLabels } from './describe'

import { durationMs, formatDuration, isFinished, takenEdges, visualNodeRuns } from '../../core/runs'
import { describeNode } from './describe'

export type RunModelNode = {
  card: NodeCardProps
  entry?: AttemptEntry
  id: string
  /** The workflow node, for visual runs. */
  kind: 'step' | WorkflowNodeType
  position: { x: number; y: number }
}

export type RunModelEdge = {
  id: string
  label?: string
  source: string
  sourceHandle?: BranchHandle | null
  taken: boolean
  target: string
}

export type RunModel = { edges: RunModelEdge[]; nodes: RunModelNode[] }

const ROW = 175

function meta(entry: AttemptEntry | undefined): string | undefined {
  if (!entry) return undefined
  const duration = formatDuration(durationMs(entry.log))
  return entry.restored ? 'Output reused from an earlier attempt' : duration
}

/** The graph for a visual workflow run: the workflow's own nodes, coloured by what happened. */
function visualModel(input: VisualRunInput, attempt: Attempt | undefined, isLatest: boolean, state: JobState, labels: TaskLabels): RunModel {
  const runs = visualNodeRuns({ attempt, input, isLatest, state })
  const taken = takenEdges(input.graph, runs)
  return {
    edges: input.graph.edges.map((edge) => ({
      ...edge,
      taken: taken.has(edge.id),
    })),
    nodes: input.graph.nodes.map((node) => {
      const run = runs[node.id]!
      const { subtitle, title } = describeNode(node, labels)
      return {
        card: { kind: node.type, meta: meta(run.entry), status: run.status, subtitle, title },
        entry: run.entry,
        id: node.id,
        kind: node.type,
        position: node.position,
      }
    }),
  }
}

/** The graph for a code workflow or a single task: one node per task run, in run order. */
function sequenceModel(attempt: Attempt | undefined, isLatest: boolean, state: JobState, labels: TaskLabels): RunModel {
  const entries = attempt?.entries ?? []
  const nodes: RunModelNode[] = entries.map((entry, index) => {
    const status: NodeRunStatus = entry.log.state === 'failed' ? 'failed' : entry.restored ? 'restored' : 'succeeded'
    return {
      card: {
        kind: 'step',
        meta: meta(entry),
        status,
        subtitle: /^\d+$/.test(entry.log.taskID) ? entry.log.taskSlug : (labels[entry.log.taskSlug] ?? entry.log.taskSlug),
        // Single-task jobs use a numeric task ID; the task's name says more.
        title: /^\d+$/.test(entry.log.taskID) ? (labels[entry.log.taskSlug] ?? entry.log.taskSlug) : entry.log.taskID,
      },
      entry,
      id: `step-${index}`,
      kind: 'step',
      position: { x: 0, y: index * ROW },
    }
  })
  if (isLatest && !isFinished(state) && !attempt?.failed) {
    nodes.push({
      card: { kind: 'step', status: 'pending', subtitle: state === 'running' ? 'Running now' : 'Waiting for the queue', title: 'Next step' },
      id: 'step-next',
      kind: 'step',
      position: { x: 0, y: nodes.length * ROW },
    })
  }
  const edges = nodes.slice(1).map((node, index) => ({
    id: `${nodes[index]!.id}-${node.id}`,
    source: nodes[index]!.id,
    taken: node.card.status !== 'pending',
    target: node.id,
  }))
  return { edges, nodes }
}

export function buildRunModel(args: {
  attempt: Attempt | undefined
  isLatest: boolean
  job: JobSnapshot
  labels: TaskLabels
  state: JobState
  visual: null | VisualRunInput
}): RunModel {
  const { attempt, isLatest, labels, state, visual } = args
  return visual ? visualModel(visual, attempt, isLatest, state, labels) : sequenceModel(attempt, isLatest, state, labels)
}
