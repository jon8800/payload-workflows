import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionBeforeChangeHook,
  PayloadRequest,
  TaskConfig,
} from 'payload'

import { Cron } from 'croner'

import type { CollectionOperation, TriggerData, WorkflowGraph } from '../core/types'
import type { ResolvedOptions } from './options'
import type { WorkflowDoc } from './runner'

import { evaluateRules } from '../core/rules'
import { getOptions, SCHEDULER_TASK_SLUG } from './options'
import { currentDepth, queueWorkflowRun } from './runner'

export function triggerOf(graph: null | undefined | WorkflowGraph): TriggerData | undefined {
  const node = graph?.nodes?.find((n) => n.type === 'trigger')
  return node?.type === 'trigger' ? node.data : undefined
}

/** The next time a cron expression fires after `from`, or null if the expression is not valid. */
export function nextCronRun(cron: string, timezone: string | undefined, from: Date): Date | null {
  try {
    return new Cron(cron, { paused: true, sloppyRanges: true, timezone }).nextRun(from)
  } catch {
    return null
  }
}

/**
 * Copies the trigger settings out of the graph into plain fields, so the scheduler and the
 * collection hooks can find workflows with a database query. Also keeps `nextRunAt` current.
 */
export const syncTriggerFields: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const graph = (data.graph ?? originalDoc?.graph) as WorkflowGraph | undefined
  const trigger = triggerOf(graph)
  const enabled = Boolean(data.enabled ?? originalDoc?.enabled)
  data.triggerKind = trigger?.kind ?? 'manual'
  data.triggerCollection = trigger?.kind === 'collection' ? (trigger.collection ?? null) : null

  const cron = trigger?.kind === 'schedule' ? (trigger.cron?.trim() ?? '') : ''
  const timezone = trigger?.timezone || undefined
  if (!enabled || !cron) {
    data.cron = null
    data.nextRunAt = null
    return data
  }
  const changed =
    cron !== originalDoc?.cron || !originalDoc?.enabled || !originalDoc?.nextRunAt || timezone !== (triggerOf(originalDoc?.graph)?.timezone || undefined)
  data.cron = cron
  if (changed || !data.nextRunAt) data.nextRunAt = nextCronRun(cron, timezone, new Date())?.toISOString() ?? null
  return data
}

/** Queues every enabled schedule workflow whose `nextRunAt` has passed, and moves `nextRunAt` on. */
export async function queueDueWorkflows(req: PayloadRequest, now = new Date()): Promise<number> {
  const { slug } = getOptions(req.payload.config)
  const { docs } = await req.payload.find({
    collection: slug as never,
    depth: 0,
    limit: 100,
    overrideAccess: true,
    pagination: false,
    req,
    where: {
      and: [
        { enabled: { equals: true } },
        { triggerKind: { equals: 'schedule' } },
        { nextRunAt: { less_than_equal: now.toISOString() } },
      ],
    },
  })

  let queued = 0
  for (const doc of docs as unknown as (WorkflowDoc & { cron?: string; nextRunAt?: string })[]) {
    const trigger = triggerOf(doc.graph)
    if (!doc.cron) continue
    await queueWorkflowRun({
      depth: 0,
      // Scheduled automation runs without an interactive user.
      overrideAccess: true,
      req,
      trigger: { cron: doc.cron, firedAt: now.toISOString(), kind: 'schedule', scheduledFor: doc.nextRunAt },
      workflow: doc,
    })
    queued++
    await req.payload.update({
      id: doc.id,
      collection: slug as never,
      context: { payloadWorkflowsSkip: true },
      data: { nextRunAt: nextCronRun(doc.cron, trigger?.timezone || undefined, now)?.toISOString() ?? null } as never,
      depth: 0,
      overrideAccess: true,
      req,
    })
  }
  return queued
}

/**
 * The plugin's own task. Payload's job scheduler queues it every minute on the plugin's queue,
 * and it queues the schedule workflows that are due. It also deletes its own finished jobs that
 * are older than an hour, so it does not fill the jobs collection when completed jobs are kept.
 */
export function schedulerTaskConfig(options: ResolvedOptions): TaskConfig<{ input: Record<string, never>; output: { queued: number } }> {
  return {
    slug: SCHEDULER_TASK_SLUG,
    label: 'Queue scheduled workflows',
    outputSchema: [{ name: 'queued', type: 'number' }],
    retries: 0,
    schedule: [{ cron: '* * * * *', queue: options.queue }],
    handler: async ({ req }) => {
      const queued = await queueDueWorkflows(req)
      await req.payload.delete({
        collection: 'payload-jobs',
        overrideAccess: true,
        req,
        where: {
          and: [
            { taskSlug: { equals: SCHEDULER_TASK_SLUG } },
            { completedAt: { less_than: new Date(Date.now() - 3_600_000).toISOString() } },
          ],
        },
      })
      return { output: { queued } }
    },
  }
}

async function queueCollectionWorkflows(args: {
  collection: string
  doc: Record<string, unknown>
  operation: CollectionOperation
  previousDoc?: Record<string, unknown>
  req: PayloadRequest
}) {
  const { collection, doc, operation, previousDoc, req } = args
  if (req.context?.payloadWorkflowsSkip) return
  const options = getOptions(req.payload.config)
  const depth = currentDepth(req)
  if (depth >= options.maxChainDepth) {
    req.payload.logger.warn(
      `payload-workflows: not starting workflows for ${collection} ${operation}: the chain of workflows is ${depth} deep (maxChainDepth).`,
    )
    return
  }

  const { docs } = await req.payload.find({
    collection: options.slug as never,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    req,
    where: {
      and: [
        { enabled: { equals: true } },
        { triggerKind: { equals: 'collection' } },
        { triggerCollection: { equals: collection } },
      ],
    },
  })

  for (const workflow of docs as unknown as WorkflowDoc[]) {
    const trigger = triggerOf(workflow.graph)
    if (!trigger?.operations?.includes(operation)) continue
    const data = { collection, doc, kind: 'collection', operation, previousDoc: previousDoc ?? null, user: userRef(req) }
    if (!evaluateRules(trigger.filter, { trigger: data }).passed) continue
    // The source collection operation already passed access checks.
    await queueWorkflowRun({ depth: depth + 1, overrideAccess: true, req, trigger: data, workflow })
  }
}

export function userRef(req: PayloadRequest) {
  return req.user ? { id: req.user.id, collection: req.user.collection, email: (req.user as { email?: string }).email } : null
}

export const afterChangeTrigger: CollectionAfterChangeHook = async ({ collection, doc, operation, previousDoc, req }) => {
  await queueCollectionWorkflows({ collection: collection.slug, doc, operation, previousDoc, req })
  return doc
}

export const afterDeleteTrigger: CollectionAfterDeleteHook = async ({ collection, doc, req }) => {
  await queueCollectionWorkflows({ collection: collection.slug, doc, operation: 'delete', req })
  return doc
}

