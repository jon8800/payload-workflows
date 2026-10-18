import type { CollectionConfig, Config, EditConfig, JobsConfig, Payload } from 'payload'

import type { ResolvedOptions, WorkflowsPluginOptions } from './options'

import { workflowsCollection } from './collection'
import { resolveOptions } from './options'
import { runWorkflowConfig } from './runner'
import { afterChangeTrigger, afterDeleteTrigger, schedulerTaskConfig } from './triggers'

const JOB_COLUMNS = ['id', 'workflowSlug', 'taskSlug', 'queue', 'processing', 'hasError', 'completedAt', 'createdAt']

type Override = NonNullable<JobsConfig['jobsCollectionOverrides']>
type AutorunCronConfig = Extract<JobsConfig['autoRun'], unknown[]>[number]

/**
 * Adds the "Run" tab to `payload-jobs`. Runs the host's own `jobsCollectionOverrides` first and
 * builds on its result. Only fills in access and visibility the host left at Payload's defaults.
 */
function withRunViewer(hostOverride: Override | undefined, options: ResolvedOptions): Override {
  return ({ defaultJobsCollection }) => {
    const base: CollectionConfig = hostOverride ? hostOverride({ defaultJobsCollection }) : defaultJobsCollection
    const viewer = options.runViewer as Exclude<ResolvedOptions['runViewer'], false>
    const fieldNames = new Set(base.fields.flatMap((field) => ('name' in field ? [field.name] : [])))
    const views = base.admin?.components?.views ?? {}
    const keepRead = base.access?.read !== defaultJobsCollection.access?.read
    const keepHidden = base.admin?.hidden !== defaultJobsCollection.admin?.hidden
    return {
      ...base,
      access: { ...base.access, read: keepRead ? base.access?.read : options.access.jobs },
      admin: {
        ...base.admin,
        defaultColumns: base.admin?.defaultColumns ?? JOB_COLUMNS.filter((name) => name === 'id' || fieldNames.has(name)),
        hidden: keepHidden ? base.admin?.hidden : !viewer.showJobsInNav,
        components: {
          ...base.admin?.components,
          views: {
            ...views,
            edit: {
              ...views.edit,
              payloadWorkflowsRun: {
                Component: {
                  path: 'payload-workflows/rsc#RunView',
                  serverProps: { refreshInterval: viewer.refreshInterval },
                },
                path: '/run',
                tab: { href: '/run', label: 'Run', order: 50 },
              },
            } as EditConfig,
          },
        },
      },
    }
  }
}

function withAutoRun(host: JobsConfig['autoRun'], options: ResolvedOptions): JobsConfig['autoRun'] {
  if (!options.autoRun) return host
  const ours: AutorunCronConfig = { cron: options.autoRun.cron, limit: options.autoRun.limit, queue: options.queue }
  const merge = (entries: AutorunCronConfig[]) =>
    entries.some((entry) => entry.allQueues || entry.queue === options.queue) ? entries : [...entries, ours]
  if (typeof host === 'function') return async (payload: Payload) => merge(await host(payload))
  return merge(host ?? [])
}

function withTriggerHooks(collection: CollectionConfig): CollectionConfig {
  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      afterChange: [...(collection.hooks?.afterChange ?? []), afterChangeTrigger],
      afterDelete: [...(collection.hooks?.afterDelete ?? []), afterDeleteTrigger],
    },
  }
}

/**
 * Payload Workflows. Adds a graph view of every job run, and a visual builder for workflows that
 * run on Payload's jobs queue.
 *
 * ```ts
 * plugins: [workflowsPlugin({ collections: ['posts'] })]
 * ```
 */
export const workflowsPlugin =
  (pluginOptions: WorkflowsPluginOptions = {}) =>
  (config: Config): Config => {
    if (pluginOptions.enabled === false) return config
    const options = resolveOptions(pluginOptions, config)
    const jobs: JobsConfig = { ...config.jobs }
    let collections = [...(config.collections ?? [])]

    if (options.runViewer) jobs.jobsCollectionOverrides = withRunViewer(config.jobs?.jobsCollectionOverrides, options)

    if (options.builder) {
      const missing = options.collections.filter((slug) => !collections.some((c) => c.slug === slug))
      if (missing.length > 0) {
        throw new Error(`payload-workflows: these trigger collections do not exist: ${missing.join(', ')}`)
      }
      collections = collections.map((collection) =>
        options.collections.includes(collection.slug) ? withTriggerHooks(collection) : collection,
      )
      collections.push(workflowsCollection(options))
      jobs.tasks = [...(jobs.tasks ?? []), schedulerTaskConfig(options)]
      jobs.workflows = [...(jobs.workflows ?? []), runWorkflowConfig(options)]
      jobs.autoRun = withAutoRun(jobs.autoRun, options)
    }

    if (options.keepCompletedJobs && jobs.deleteJobOnComplete === undefined) jobs.deleteJobOnComplete = false

    return {
      ...config,
      collections,
      custom: { ...config.custom, payloadWorkflows: options },
      jobs,
    }
  }
