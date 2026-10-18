import type { Access, Config, PayloadRequest, TaskConfig } from 'payload'

export const RUN_WORKFLOW_SLUG = 'payloadWorkflowsRun'
export const SCHEDULER_TASK_SLUG = 'payloadWorkflowsSchedule'
/** Tasks that never appear in the builder's palette. */
export const INTERNAL_TASKS = [SCHEDULER_TASK_SLUG, 'schedulePublish', 'inline']

// Payload's own access type, so a project's existing access functions plug straight in.
export type AccessFn = Access

export type WorkflowsPluginOptions = {
  /** Set to false to turn the whole plugin off without removing it. */
  enabled?: boolean
  /**
   * Milestone 1: the "Run" tab on `payload-jobs` documents.
   * @default true
   */
  runViewer?:
    | boolean
    | {
        /** Milliseconds between refreshes while a job is still running. @default 2000 */
        refreshInterval?: number
        /** Show the jobs collection in the admin navigation. @default true */
        showJobsInNav?: boolean
      }
  /**
   * Milestone 2: the workflows collection, the visual builder, and the runner.
   * @default true
   */
  builder?: boolean
  /** Slug of the workflows collection. @default 'workflows' */
  slug?: string
  /** Collections whose create, update and delete events can start a workflow. @default [] */
  collections?: string[]
  /** Access control. Each defaults to "a user of the admin user collection is signed in". */
  access?: {
    /** Read access to `payload-jobs`, used by the run viewer. Applied only if your config did not set it. */
    jobs?: AccessFn
    /** Who can start a workflow with "Run now". */
    run?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
    /** Read, create, update and delete access to the workflows collection. */
    workflows?: AccessFn
  }
  /**
   * Which registered tasks appear in the builder's palette.
   * @default every task in `config.jobs.tasks` except the plugin's own and Payload's internal ones
   */
  tasks?: ((task: TaskConfig) => boolean) | string[]
  /** The jobs queue for workflow runs and the scheduler. @default 'workflows' */
  queue?: string
  /**
   * Adds a `jobs.autoRun` entry that runs the queue every minute, and schedules due workflows. Set
   * to false on serverless hosts and call `/api/payload-jobs/run?queue=<queue>` and
   * `/api/payload-jobs/handle-schedules?queue=<queue>` from your own cron instead.
   * @default true
   */
  autoRun?: boolean | { cron?: string; limit?: number }
  /**
   * Keeps completed jobs so the run viewer can show them. Applies only when your config does not
   * set `jobs.deleteJobOnComplete` itself.
   * @default true
   */
  keepCompletedJobs?: boolean
  /**
   * How many workflows may start each other in a chain through collection events. Stops a
   * workflow that updates a document from triggering itself forever.
   * @default 3
   */
  maxChainDepth?: number
}

export type ResolvedOptions = {
  access: Required<NonNullable<WorkflowsPluginOptions['access']>>
  autoRun: false | { cron: string; limit: number }
  builder: boolean
  collections: string[]
  keepCompletedJobs: boolean
  maxChainDepth: number
  queue: string
  runViewer: false | { refreshInterval: number; showJobsInNav: boolean }
  slug: string
  tasks: (task: TaskConfig) => boolean
}

export function resolveOptions(options: WorkflowsPluginOptions, config: Config): ResolvedOptions {
  const adminCollection = config.admin?.user ?? 'users'
  const isAdmin = ({ req }: { req: PayloadRequest }) =>
    Boolean(req.user) && (req.user?.collection === undefined || req.user.collection === adminCollection)

  const viewer = options.runViewer ?? true
  const autoRun = options.autoRun ?? true
  const tasks = options.tasks
  return {
    access: {
      jobs: options.access?.jobs ?? isAdmin,
      run: options.access?.run ?? isAdmin,
      workflows: options.access?.workflows ?? isAdmin,
    },
    autoRun: autoRun === false ? false : { cron: '* * * * *', limit: 10, ...(autoRun === true ? {} : autoRun) },
    builder: options.builder ?? true,
    collections: options.collections ?? [],
    keepCompletedJobs: options.keepCompletedJobs ?? true,
    maxChainDepth: options.maxChainDepth ?? 3,
    queue: options.queue ?? 'workflows',
    runViewer:
      viewer === false
        ? false
        : {
            refreshInterval: (viewer === true ? undefined : viewer.refreshInterval) ?? 2000,
            showJobsInNav: (viewer === true ? undefined : viewer.showJobsInNav) ?? true,
          },
    slug: options.slug ?? 'workflows',
    tasks: Array.isArray(tasks)
      ? (task) => tasks.includes(task.slug)
      : (task) => !INTERNAL_TASKS.includes(task.slug) && (tasks ? tasks(task) : true),
  }
}

/** The plugin stores its resolved options here, so hooks, endpoints and admin components can read them. */
export function getOptions(config: { custom?: Record<string, unknown> }): ResolvedOptions {
  const options = config.custom?.payloadWorkflows as ResolvedOptions | undefined
  if (!options) throw new Error('payload-workflows: the plugin is not installed in this config.')
  return options
}
