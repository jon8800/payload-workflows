import type { Job, JobsConfig, Payload, PayloadRequest, TaskConfig } from 'payload'

import type { RunContext, VisualRunInput, WorkflowGraph } from '../core/types'
import type { ResolvedOptions } from './options'

import { evaluateRules } from '../core/rules'
import { resolveTemplates } from '../core/template'
import { validateGraph } from '../core/validate'
import { coerceInput, delayToMs, walkGraph } from '../core/walk'
import { buildCatalogue } from './catalogue'
import { getOptions, RUN_WORKFLOW_SLUG } from './options'

export type WorkflowDoc = {
  enabled?: boolean | null
  graph?: null | WorkflowGraph
  id: number | string
  title?: null | string
}

type RunContextFlag = { depth: number }

/** A task runner without the host app's generated task types, which this plugin cannot know. */
type RunAnyTask = (taskID: string, args: { input: unknown; retries?: number }) => Promise<unknown>

/** The chain depth of the code that is running now, read from `req.context`. */
export function currentDepth(req: PayloadRequest): number {
  return (req.context?.payloadWorkflows as RunContextFlag | undefined)?.depth ?? 0
}

export function catalogueFor(payload: Payload) {
  return buildCatalogue(payload.config.jobs?.tasks as TaskConfig[] | undefined, getOptions(payload.config).tasks)
}

/** Queues one run of a visual workflow on the plugin's queue. */
export async function queueWorkflowRun(args: {
  depth?: number
  overrideAccess?: boolean
  req: PayloadRequest
  trigger: Record<string, unknown>
  waitUntil?: Date
  workflow: WorkflowDoc
}): Promise<Job> {
  const { depth, overrideAccess = false, req, trigger, waitUntil, workflow } = args
  const options = getOptions(req.payload.config)
  if (!workflow.graph) throw new Error(`Workflow ${workflow.id} has no graph.`)
  const input: VisualRunInput = {
    depth: depth ?? currentDepth(req),
    graph: workflow.graph,
    trigger,
    workflowId: String(workflow.id),
    workflowTitle: workflow.title ?? undefined,
  }
  return (await req.payload.jobs.queue({
    input: input as never,
    overrideAccess,
    queue: options.queue,
    req,
    waitUntil,
    workflow: RUN_WORKFLOW_SLUG as never,
  })) as unknown as Job
}

/**
 * The one Payload workflow that runs every visual workflow. It walks the graph stored in the job
 * input. Each Task node becomes a real Payload task call with the node id as its task ID, so
 * Payload's retries and resume-after-failure work as usual: on a retry, steps that already
 * succeeded return their saved output instead of running again. Conditions and Delays run as
 * inline tasks for the same reason, and so they show up in the job log.
 */
export function runWorkflowConfig(options: ResolvedOptions): NonNullable<JobsConfig['workflows']>[number] {
  return {
    slug: RUN_WORKFLOW_SLUG,
    label: 'Visual workflow',
    queue: options.queue,
    inputSchema: [
      { name: 'workflowId', type: 'text', required: true },
      { name: 'workflowTitle', type: 'text' },
      { name: 'graph', type: 'json', required: true },
      { name: 'trigger', type: 'json' },
      { name: 'resume', type: 'json' },
      { name: 'depth', type: 'number' },
    ],
    handler: async ({ inlineTask, job, req, tasks }) => {
      const input = job.input as unknown as VisualRunInput
      const catalogue = catalogueFor(req.payload)
      const issues = validateGraph(input.graph, catalogue)
      if (issues.length > 0) {
        throw new Error(`The workflow is not valid: ${issues.map((issue) => issue.message).join(' ')}`)
      }

      req.context = { ...req.context, payloadWorkflows: { depth: input.depth ?? 0 } satisfies RunContextFlag }
      const context: RunContext = {
        steps: { ...input.resume?.steps },
        trigger: input.trigger ?? {},
        workflow: { id: input.workflowId, title: input.workflowTitle },
      }

      await walkGraph({
        context,
        graph: input.graph,
        startAfter: input.resume?.nodeId,
        runNode: async (node, ctx) => {
          if (node.type === 'task') {
            const run = (tasks as unknown as Record<string, RunAnyTask | undefined>)[node.data.task]
            if (!run) throw new Error(`The task "${node.data.task}" is not registered.`)
            const resolved = resolveTemplates(node.data.input ?? {}, ctx) as Record<string, unknown>
            const taskInput = coerceInput(catalogue[node.data.task]?.fields, resolved)
            const output = await run(node.id, { input: taskInput, retries: node.data.retries })
            return { output }
          }

          if (node.type === 'condition') {
            const output = await inlineTask(node.id, {
              input: { match: node.data.match, rules: node.data.rules },
              task: () => {
                const { passed, results } = evaluateRules(node.data, ctx)
                return { output: { branch: passed ? 'true' : 'false', result: passed, rules: results } }
              },
            })
            return { branch: (output as { branch: 'false' | 'true' }).branch, output }
          }

          const ms = delayToMs(node.data.amount, node.data.unit)
          const output = await inlineTask(node.id, {
            input: { amount: node.data.amount, unit: node.data.unit },
            task: async ({ req: taskReq }) => {
              const waitUntil = new Date(Date.now() + ms)
              const next = (await taskReq.payload.jobs.queue({
                // The worker continues a workflow that already passed its initial access check.
                overrideAccess: true,
                input: {
                  ...input,
                  resume: {
                    nodeId: node.id,
                    parentJob: job.id,
                    steps: { ...ctx.steps, [node.id]: { output: { waitUntil: waitUntil.toISOString() } } },
                  },
                } satisfies VisualRunInput as never,
                queue: job.queue ?? options.queue,
                req: taskReq,
                waitUntil,
                workflow: RUN_WORKFLOW_SLUG as never,
              })) as unknown as Job
              return { output: { continuedIn: next.id, waitUntil: waitUntil.toISOString() } }
            },
          })
          return { output, stop: true }
        },
      })
    },
  }
}
