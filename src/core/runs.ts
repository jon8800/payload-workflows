import type { BranchHandle, VisualRunInput, WorkflowGraph } from './types'

/** One entry of a job's `log`, as Payload stores it. */
export type JobLogEntry = {
  completedAt: string
  error?: unknown
  executedAt: string
  id?: null | string
  input?: unknown
  output?: unknown
  parent?: null | { taskID?: null | string; taskSlug?: null | string }
  state: 'failed' | 'succeeded'
  taskID: string
  taskSlug: string
}

/** The job fields the run viewer reads. */
export type JobSnapshot = {
  completedAt?: null | string
  createdAt?: string
  error?: unknown
  hasError?: boolean | null
  id: number | string
  input?: unknown
  log?: JobLogEntry[] | null
  processing?: boolean | null
  queue?: null | string
  taskSlug?: null | string
  totalTried?: null | number
  updatedAt?: string
  waitUntil?: null | string
  workflowSlug?: null | string
}

export type AttemptEntry = {
  log: JobLogEntry
  /** True when the task succeeded in an earlier attempt and Payload reused its output. */
  restored: boolean
}

export type Attempt = {
  entries: AttemptEntry[]
  /** True when the attempt ended with a failed task. */
  failed: boolean
  index: number
}

const key = (entry: JobLogEntry) => `${entry.taskSlug}:${entry.taskID}`

/**
 * Splits a job log into attempts. Payload re-runs a failed workflow from the start, and every task
 * that already succeeded returns its saved output without a new log entry. So each failed log
 * entry ends an attempt, and the next attempt starts with the earlier successes, marked restored.
 */
export function logToAttempts(log: JobLogEntry[] | null | undefined): Attempt[] {
  const attempts: Attempt[] = []
  const succeeded = new Map<string, JobLogEntry>()
  let current: JobLogEntry[] = []

  const close = (failed: boolean) => {
    const fresh = new Set(current.map(key))
    const restored = [...succeeded.values()].filter((entry) => !fresh.has(key(entry)))
    attempts.push({
      entries: [
        ...restored.map((entry) => ({ log: entry, restored: true })),
        ...current.map((entry) => ({ log: entry, restored: false })),
      ],
      failed,
      index: attempts.length,
    })
    for (const entry of current) if (entry.state === 'succeeded') succeeded.set(key(entry), entry)
    current = []
  }

  for (const entry of log ?? []) {
    current.push(entry)
    if (entry.state === 'failed') close(true)
  }
  if (current.length > 0) close(false)
  return attempts
}

export type JobState = 'cancelled' | 'completed' | 'failed' | 'queued' | 'retrying' | 'running' | 'scheduled'

export function jobState(job: JobSnapshot, now = Date.now()): JobState {
  if (job.completedAt) return 'completed'
  if (job.hasError) {
    const cancelled = typeof job.error === 'object' && job.error !== null && 'cancelled' in job.error && job.error.cancelled
    return cancelled ? 'cancelled' : 'failed'
  }
  if (job.processing) return 'running'
  if ((job.totalTried ?? 0) > 0) return 'retrying'
  if (job.waitUntil && Date.parse(job.waitUntil) > now) return 'scheduled'
  return 'queued'
}

export function isFinished(state: JobState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled'
}

export function durationMs(entry: Pick<JobLogEntry, 'completedAt' | 'executedAt'>): null | number {
  const ms = Date.parse(entry.completedAt) - Date.parse(entry.executedAt)
  return Number.isFinite(ms) ? ms : null
}

export function formatDuration(ms: null | number): string {
  if (ms === null) return ''
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes} min ${seconds} s`
}

export type NodeRunStatus =
  | 'earlier'
  | 'failed'
  | 'notReached'
  | 'pending'
  | 'restored'
  | 'skipped'
  | 'succeeded'
  | 'waiting'

export type NodeRun = { entry?: AttemptEntry; status: NodeRunStatus }

export function isVisualRunInput(input: unknown): input is VisualRunInput {
  if (!input || typeof input !== 'object') return false
  const graph = (input as { graph?: WorkflowGraph }).graph
  return Boolean(graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges))
}

/**
 * Works out what happened to each node of a visual workflow in one attempt: it ran, failed, was
 * reused from an earlier attempt, was skipped (its branch was not taken), or has not run yet.
 */
export function visualNodeRuns(args: {
  attempt: Attempt | undefined
  input: VisualRunInput
  isLatest: boolean
  state: JobState
}): Record<string, NodeRun> {
  const { attempt, input, isLatest, state } = args
  const entries = new Map((attempt?.entries ?? []).filter((e) => !e.log.parent?.taskID).map((e) => [e.log.taskID, e]))
  const earlier = new Set(Object.keys(input.resume?.steps ?? {}))
  const runs: Record<string, NodeRun> = {}

  for (const node of input.graph.nodes) {
    const entry = entries.get(node.id)
    if (node.type === 'trigger') {
      runs[node.id] = { status: input.resume ? 'earlier' : attempt || state === 'completed' ? 'succeeded' : 'pending' }
    } else if (input.resume?.nodeId === node.id) {
      runs[node.id] = { status: 'succeeded' }
    } else if (earlier.has(node.id)) {
      runs[node.id] = { status: 'earlier' }
    } else if (entry) {
      const delayed = node.type === 'delay' && entry.log.state === 'succeeded'
      runs[node.id] = {
        entry,
        status: entry.log.state === 'failed' ? 'failed' : delayed ? 'waiting' : entry.restored ? 'restored' : 'succeeded',
      }
    } else if (state === 'completed') {
      runs[node.id] = { status: 'skipped' }
    } else if (!isLatest || attempt?.failed || isFinished(state)) {
      runs[node.id] = { status: 'notReached' }
    } else {
      runs[node.id] = { status: 'pending' }
    }
  }
  return runs
}

const DONE: NodeRunStatus[] = ['succeeded', 'restored', 'earlier']
const REACHED: NodeRunStatus[] = ['succeeded', 'restored', 'earlier', 'failed', 'waiting']

/** The ids of the connections the run followed. */
export function takenEdges(graph: WorkflowGraph, runs: Record<string, NodeRun>): Set<string> {
  const taken = new Set<string>()
  for (const edge of graph.edges) {
    const source = runs[edge.source]
    const target = runs[edge.target]
    if (!source || !target || !DONE.includes(source.status) || !REACHED.includes(target.status)) continue
    const node = graph.nodes.find((n) => n.id === edge.source)
    if (node?.type === 'condition') {
      const branch = (source.entry?.log.output as { branch?: BranchHandle } | undefined)?.branch
      if (branch && edge.sourceHandle !== branch) continue
    }
    taken.add(edge.id)
  }
  return taken
}
