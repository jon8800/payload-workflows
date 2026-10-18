'use client'

import './styles.scss'

import { SetDocumentStepNav, useConfig } from '@payloadcms/ui'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'

import type { JobSnapshot, JobState } from '../../core/runs'
import type { TaskLabels } from './describe'

import { isFinished, isVisualRunInput, jobState, logToAttempts } from '../../core/runs'
import { RunDetails } from './RunDetails'
import { buildRunModel } from './runModel'

const RunGraph = lazy(() => import('./RunGraph'))

const STATE_LABELS: Record<JobState, string> = {
  cancelled: 'Cancelled',
  completed: 'Completed',
  failed: 'Failed',
  queued: 'Queued',
  retrying: 'Waiting to retry',
  running: 'Running',
  scheduled: 'Scheduled',
}

export type RunViewerProps = {
  adminRoute: string
  initialJob: JobSnapshot
  refreshInterval: number
  taskLabels: TaskLabels
  workflowsSlug?: string
}

function formatDate(value: null | string | undefined): string {
  return value ? new Date(value).toLocaleString() : ''
}

function emptyMessage(job: JobSnapshot, state: JobState): string {
  switch (state) {
    case 'running':
      return 'The job is running. No step has finished yet. This page updates by itself.'
    case 'scheduled':
      return `The job is scheduled to run after ${formatDate(job.waitUntil)}.`
    case 'failed':
      return 'The job failed before any task ran. See the error on the right.'
    case 'cancelled':
      return 'The job was cancelled before any task ran.'
    case 'completed':
      return 'The job completed without running any task.'
    default:
      return `The job is waiting in the "${job.queue ?? 'default'}" queue. It runs when that queue is processed.`
  }
}

/** The Run tab of a job: a live graph of its task runs, one attempt at a time. */
export function RunViewer({ adminRoute, initialJob, refreshInterval, taskLabels, workflowsSlug }: RunViewerProps) {
  const { config, getEntityConfig } = useConfig()
  const [job, setJob] = useState(initialJob)
  const [attemptIndex, setAttemptIndex] = useState<null | number>(null)
  const [selected, setSelected] = useState<null | string>(null)

  const state = jobState(job)
  const finished = isFinished(state)

  useEffect(() => {
    if (finished) return
    const url = `${config.serverURL}${config.routes.api}/payload-jobs/${job.id}?depth=0`
    const timer = setInterval(async () => {
      const response = await fetch(url, { credentials: 'include' }).catch(() => null)
      if (response?.ok) setJob((await response.json()) as JobSnapshot)
    }, refreshInterval)
    return () => clearInterval(timer)
  }, [config.routes.api, config.serverURL, finished, job.id, refreshInterval])

  const attempts = useMemo(() => logToAttempts(job.log), [job.log])
  const latest = attempts.length - 1
  const shown = attemptIndex ?? latest
  const attempt = attempts[shown]
  const visual = isVisualRunInput(job.input) ? job.input : null
  const model = useMemo(
    () => buildRunModel({ attempt, isLatest: shown === latest, job, labels: taskLabels, state, visual }),
    [attempt, job, latest, shown, state, taskLabels, visual],
  )
  const selectedNode = model.nodes.find((node) => node.id === selected) ?? null
  const jobsConfig = getEntityConfig({ collectionSlug: 'payload-jobs' })

  const title = visual
    ? visual.workflowTitle || 'Visual workflow'
    : job.workflowSlug
      ? `Workflow: ${job.workflowSlug}`
      : `Task: ${(job.taskSlug && taskLabels[job.taskSlug]) || job.taskSlug || 'unknown'}`
  const workflowHref = visual && workflowsSlug ? `${adminRoute}/collections/${workflowsSlug}/${visual.workflowId}` : null
  const parentJob = visual?.resume?.parentJob

  return (
    <div className="pw-run">
      <SetDocumentStepNav
        collectionSlug="payload-jobs"
        id={job.id}
        pluralLabel={jobsConfig?.labels?.plural}
        useAsTitle={jobsConfig?.admin?.useAsTitle}
        view="Run"
      />
      <header className="pw-run__header">
        <div className="pw-run__heading">
          <span className={`pw-state pw-state--${state}`}>
            {!finished && <span className="pw-state__pulse" />}
            {STATE_LABELS[state]}
          </span>
          <h2 className="pw-run__title">
            {workflowHref ? <a href={workflowHref}>{title}</a> : title}
          </h2>
        </div>
        <dl className="pw-run__facts">
          <div>
            <dt>Queue</dt>
            <dd>{job.queue ?? 'default'}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd suppressHydrationWarning>{formatDate(job.createdAt)}</dd>
          </div>
          {job.completedAt && (
            <div>
              <dt>Completed</dt>
              <dd suppressHydrationWarning>{formatDate(job.completedAt)}</dd>
            </div>
          )}
          {!finished && job.waitUntil && (
            <div>
              <dt>Next try</dt>
              <dd suppressHydrationWarning>{formatDate(job.waitUntil)}</dd>
            </div>
          )}
          <div>
            <dt>Tries</dt>
            <dd>{job.totalTried ?? 0}</dd>
          </div>
          {parentJob !== undefined && (
            <div>
              <dt>Continues</dt>
              <dd>
                <a href={`${adminRoute}/collections/payload-jobs/${parentJob}/run`}>Job {parentJob}</a>
              </dd>
            </div>
          )}
        </dl>
        {attempts.length > 1 && (
          <div className="pw-attempts">
            {attempts.map((item) => (
              <button
                aria-pressed={item.index === shown}
                className={`pw-attempts__item${item.index === shown ? ' pw-attempts__item--active' : ''}`}
                key={item.index}
                onClick={() => {
                  setAttemptIndex(item.index === latest ? null : item.index)
                  setSelected(null)
                }}
                type="button"
              >
                <span className={`pw-dot pw-dot--${item.failed ? 'failed' : item.index === latest && !finished ? 'pending' : 'succeeded'}`} />
                Attempt {item.index + 1}
                {item.index === latest ? ' (latest)' : ''}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="pw-run__body">
        <div className="pw-canvas">
          {model.nodes.length === 0 ? (
            <div className="pw-empty">
              <p className="pw-empty__title">No steps have run yet</p>
              <p className="pw-empty__text">{emptyMessage(job, state)}</p>
            </div>
          ) : (
            <Suspense fallback={null}>
              <RunGraph key={`${shown}-${model.nodes.length}`} model={model} onSelect={setSelected} selected={selected} />
            </Suspense>
          )}
        </div>
        <RunDetails adminRoute={adminRoute} job={job} node={selectedNode} labels={taskLabels} visual={visual} />
      </div>
    </div>
  )
}
