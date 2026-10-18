// The stored shape of a visual workflow. It is plain JSON: the editor writes it, the runner reads it,
// and the run viewer draws it. Node and edge objects match React Flow's shape on purpose, so the
// editor can pass them to React Flow without converting.

export type XYPosition = { x: number; y: number }

export type TriggerKind = 'collection' | 'manual' | 'schedule'
export type CollectionOperation = 'create' | 'delete' | 'update'

export type RuleOperator =
  | 'contains'
  | 'equals'
  | 'exists'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'notContains'
  | 'notEquals'
  | 'notExists'

/** One comparison. `left` and `right` may be literals or templates such as `{{trigger.doc.status}}`. */
export type Rule = {
  left: string
  operator: RuleOperator
  right?: string
}

export type RuleGroup = {
  match: 'all' | 'any'
  rules: Rule[]
}

export type TriggerData = {
  kind: TriggerKind
  label?: string
  /** Schedule triggers: a cron expression, 5 fields (minute precision) or 6 fields (with seconds). */
  cron?: string
  /** Schedule triggers: an IANA time zone for the cron expression. Defaults to the server's. */
  timezone?: string
  /** Collection triggers: the collection slug. */
  collection?: string
  /** Collection triggers: the operations that start the workflow. */
  operations?: CollectionOperation[]
  /** Collection triggers: optional rules over `trigger.doc` and `trigger.previousDoc`. */
  filter?: RuleGroup
  /** Data available as `{{trigger.data}}` when the workflow is started with "Run now". */
  sampleData?: Record<string, unknown>
}

export type TaskNodeData = {
  /** The slug of a task registered in `config.jobs.tasks`. */
  task: string
  label?: string
  /** Input values by field name. Values may contain templates. */
  input: Record<string, unknown>
  /** Overrides the task's own `retries` for this step. */
  retries?: number
}

export type ConditionNodeData = RuleGroup & { label?: string }

export type DelayUnit = 'days' | 'hours' | 'minutes' | 'seconds'

export type DelayNodeData = {
  amount: number
  label?: string
  unit: DelayUnit
}

type BaseNode<TType extends string, TData> = {
  data: TData
  id: string
  position: XYPosition
  type: TType
}

export type TriggerNode = BaseNode<'trigger', TriggerData>
export type TaskNode = BaseNode<'task', TaskNodeData>
export type ConditionNode = BaseNode<'condition', ConditionNodeData>
export type DelayNode = BaseNode<'delay', DelayNodeData>
export type WorkflowNode = ConditionNode | DelayNode | TaskNode | TriggerNode
export type WorkflowNodeType = WorkflowNode['type']

/** Condition nodes have two outgoing handles. Other nodes have one, with no handle id. */
export type BranchHandle = 'false' | 'true'

export type WorkflowEdge = {
  id: string
  source: string
  sourceHandle?: BranchHandle | null
  target: string
}

export type WorkflowGraph = {
  edges: WorkflowEdge[]
  nodes: WorkflowNode[]
}

/** The input of one field of a task's `inputSchema`, reduced to what the editor needs. */
export type TaskInputField = {
  description?: string
  hasMany?: boolean
  label: string
  name: string
  options?: { label: string; value: string }[]
  relationTo?: string | string[]
  required: boolean
  type: 'checkbox' | 'date' | 'email' | 'json' | 'number' | 'relationship' | 'select' | 'text' | 'textarea'
}

/** A task that can be placed on the canvas. Built on the server from `config.jobs.tasks`. */
export type TaskCatalogueEntry = {
  fields: TaskInputField[]
  label: string
  /** Names of the task's `outputSchema` fields, offered as `{{steps.<id>.output.<name>}}`. */
  outputs: string[]
  retries?: number
  slug: string
}

export type TaskCatalogue = Record<string, TaskCatalogueEntry>

/** The data that templates can read while a workflow runs. */
export type RunContext = {
  steps: Record<string, { output: unknown }>
  trigger: Record<string, unknown>
  workflow: { id: string; title?: string }
}

/** Input of the plugin's generic Payload workflow. */
export type VisualRunInput = {
  /** Set by "Run now" and collection triggers; guards against workflows that trigger each other forever. */
  depth?: number
  /** A copy of the graph at queue time, so editing the workflow does not change a run in flight. */
  graph: WorkflowGraph
  /** Set when this job continues a run after a Delay node. */
  resume?: { nodeId: string; parentJob?: number | string; steps: RunContext['steps'] }
  trigger: Record<string, unknown>
  workflowId: string
  workflowTitle?: string
}
