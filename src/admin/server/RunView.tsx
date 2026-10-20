import type { DocumentViewServerProps, TaskConfig } from 'payload'

import { Gutter } from '@payloadcms/ui'

import type { JobSnapshot } from '../../core/runs'
import type { ResolvedOptions } from '../../plugin/options'

import { humanize } from '../../plugin/catalogue'
import { RunViewer } from '../client/RunViewer'

/** The "Run" tab of a `payload-jobs` document. Server component; the graph is a client leaf. */
export function RunView(props: DocumentViewServerProps & { refreshInterval?: number }) {
  const { doc, payload, refreshInterval } = props
  const options = payload.config.custom?.payloadWorkflows as ResolvedOptions | undefined
  const tasks = (payload.config.jobs?.tasks ?? []) as TaskConfig[]
  const taskLabels: Record<string, string> = { inline: 'Inline task' }
  for (const task of tasks) taskLabels[task.slug] = task.label ?? humanize(task.slug)

  const job: JobSnapshot = {
    completedAt: doc.completedAt,
    createdAt: doc.createdAt,
    error: doc.error,
    hasError: doc.hasError,
    id: doc.id,
    input: doc.input,
    log: doc.log,
    processing: doc.processing,
    processingUntil: doc.processingUntil,
    queue: doc.queue,
    taskSlug: doc.taskSlug,
    totalTried: doc.totalTried,
    updatedAt: doc.updatedAt,
    waitUntil: doc.waitUntil,
    workflowSlug: doc.workflowSlug,
  }

  return (
    <Gutter>
      <RunViewer
        adminRoute={payload.config.routes.admin}
        initialJob={job}
        refreshInterval={refreshInterval ?? 2000}
        taskLabels={taskLabels}
        workflowsSlug={options?.builder ? options.slug : undefined}
      />
    </Gutter>
  )
}
