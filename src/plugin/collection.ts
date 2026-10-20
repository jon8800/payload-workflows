import type { CollectionConfig, Endpoint, PayloadRequest } from 'payload'

import type { WorkflowGraph } from '../core/types'
import type { ResolvedOptions } from './options'
import type { WorkflowDoc } from './runner'

import { validateGraph } from '../core/validate'
import { catalogueFor, queueWorkflowRun } from './runner'
import { syncTriggerFields, triggerOf, userRef } from './triggers'

export const TRIGGER_NODE_ID = 'trigger'

export function emptyGraph(): WorkflowGraph {
  return {
    edges: [],
    nodes: [{ id: TRIGGER_NODE_ID, data: { kind: 'manual' }, position: { x: 0, y: 0 }, type: 'trigger' }],
  }
}

function runNowEndpoint(options: ResolvedOptions): Endpoint {
  return {
    method: 'post',
    path: '/:id/run',
    handler: async (req: PayloadRequest) => {
      if (!(await options.access.run({ req }))) {
        return Response.json({ error: 'You are not allowed to run workflows.' }, { status: 403 })
      }
      const id = req.routeParams?.id as string
      const workflow = (await req.payload.findByID({
        collection: options.slug as never,
        depth: 0,
        id,
        overrideAccess: false,
        req,
      })) as unknown as WorkflowDoc
      const issues = validateGraph(workflow.graph ?? emptyGraph(), catalogueFor(req.payload), {
        collections: options.collections,
      })
      if (issues.length > 0) return Response.json({ error: 'The workflow is not valid.', issues }, { status: 400 })

      const trigger = triggerOf(workflow.graph)
      const job = await queueWorkflowRun({
        depth: 0,
        req,
        trigger: { data: trigger?.sampleData ?? {}, kind: 'manual', user: userRef(req) },
        workflow,
      })
      // Start it now rather than on the next autoRun tick. The response does not wait for the run;
      // the run viewer shows its progress.
      void req.payload.jobs.runByID({ id: job.id, req, overrideAccess: false }).catch((err: unknown) => {
        req.payload.logger.error({ err, msg: `payload-workflows: run of job ${job.id} failed to start` })
      })
      return Response.json({ jobId: job.id })
    },
  }
}

export function workflowsCollection(options: ResolvedOptions): CollectionConfig {
  const access = options.access.workflows
  return {
    slug: options.slug,
    access: { create: access, delete: access, read: access, update: access },
    admin: {
      components: {
        edit: { beforeDocumentControls: ['payload-workflows/client#RunNowButton'] },
      },
      defaultColumns: ['title', 'enabled', 'triggerKind', 'nextRunAt', 'updatedAt'],
      description: 'Automations that run tasks when something happens. Drag tasks onto the canvas and connect them.',
      group: 'Automation',
      useAsTitle: 'title',
    },
    endpoints: [runNowEndpoint(options)],
    fields: [
      { name: 'title', type: 'text', required: true },
      {
        type: 'row',
        fields: [
          {
            name: 'enabled',
            type: 'checkbox',
            admin: {
              description: 'Starts on its schedule or collection event. "Run now" works either way.',
              width: '40%',
            },
            defaultValue: false,
          },
          {
            name: 'triggerKind',
            type: 'select',
            admin: { readOnly: true, width: '30%' },
            index: true,
            label: 'Trigger',
            options: [
              { label: 'Manual', value: 'manual' },
              { label: 'Schedule', value: 'schedule' },
              { label: 'Collection event', value: 'collection' },
            ],
          },
          {
            name: 'nextRunAt',
            type: 'date',
            admin: {
              condition: (data) => Boolean(data?.nextRunAt),
              date: { displayFormat: 'd MMM yyyy, HH:mm', pickerAppearance: 'dayAndTime' },
              readOnly: true,
              width: '30%',
            },
            index: true,
            label: 'Next run',
          },
        ],
      },
      {
        name: 'graph',
        type: 'json',
        admin: { components: { Field: 'payload-workflows/rsc#WorkflowBuilderField' } },
        defaultValue: emptyGraph,
        label: 'Workflow',
        validate: (value: unknown, { req, siblingData }: { req: PayloadRequest; siblingData: Record<string, unknown> }) => {
          if (!siblingData?.enabled || !value) return true
          const issues = validateGraph(value as WorkflowGraph, catalogueFor(req.payload), {
            collections: options.collections,
          })
          if (issues.length === 0) return true
          return `Fix ${issues.length === 1 ? 'this problem' : `these ${issues.length} problems`} before enabling the workflow: ${issues.map((issue) => issue.message).join(' ')}`
        },
      },
      { name: 'triggerCollection', type: 'text', admin: { hidden: true }, index: true },
      { name: 'cron', type: 'text', admin: { hidden: true } },
    ],
    hooks: { beforeChange: [syncTriggerFields] },
    labels: { plural: 'Workflows', singular: 'Workflow' },
  }
}
