'use client'

import type { JobSnapshot } from '../../core/runs'
import type { VisualRunInput } from '../../core/types'
import type { TaskLabels } from './describe'
import type { RunModelNode } from './runModel'

import { durationMs, formatDuration } from '../../core/runs'
import { NodeIcon } from './icons'
import { STATUS_LABELS } from './NodeCard'

type ErrorShape = { message?: string; name?: string; stack?: string }

function hasContent(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (!hasContent(value)) return null
  return (
    <section className="pw-details__section">
      <h4 className="pw-details__label">{label}</h4>
      <pre className="pw-code">{JSON.stringify(value, null, 2)}</pre>
    </section>
  )
}

function ErrorBlock({ error }: { error: unknown }) {
  if (!error || typeof error !== 'object') return null
  const { message, name, stack } = error as ErrorShape
  return (
    <section className="pw-details__section">
      <h4 className="pw-details__label">Error</h4>
      <div className="pw-error">
        <p className="pw-error__message">
          {name && name !== 'Error' ? <strong>{name}: </strong> : null}
          {message}
        </p>
        {stack && (
          <details className="pw-error__stack">
            <summary>Stack trace</summary>
            <pre className="pw-code">{stack}</pre>
          </details>
        )}
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="pw-details__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

const NOT_RUN: Record<string, string> = {
  earlier: 'This step ran in an earlier job, before the Delay.',
  notReached: 'The run stopped before this step.',
  pending: 'This step has not run yet.',
  skipped: 'This step was skipped: the run took another branch.',
}

/** The side panel of the run viewer: the job overview, or the details of the selected step. */
export function RunDetails({
  adminRoute,
  job,
  labels,
  node,
  visual,
}: {
  adminRoute: string
  job: JobSnapshot
  labels: TaskLabels
  node: null | RunModelNode
  visual: null | VisualRunInput
}) {
  if (!node) {
    const input = visual ? visual.trigger : job.input
    return (
      <aside className="pw-details">
        <h3 className="pw-details__title">Job {job.id}</h3>
        <p className="pw-details__hint">Select a step to see its input, output and error.</p>
        <Json label={visual ? 'Trigger data' : 'Input'} value={input} />
        <ErrorBlock error={job.error} />
      </aside>
    )
  }

  const { card, entry } = node
  const log = entry?.log
  const output = log?.output as { continuedIn?: number | string; waitUntil?: string } | undefined
  const isTrigger = node.kind === 'trigger'

  return (
    <aside className="pw-details">
      <div className="pw-details__head">
        <span className={`pw-node__icon pw-node__icon--${node.kind}`}>
          <NodeIcon type={node.kind} />
        </span>
        <h3 className="pw-details__title">{card.title}</h3>
        {card.status && <span className={`pw-status pw-status--${card.status}`}>{STATUS_LABELS[card.status]}</span>}
      </div>
      {card.subtitle && <p className="pw-details__hint">{card.subtitle}</p>}

      {log ? (
        <dl className="pw-details__rows">
          <Row label="Task" value={labels[log.taskSlug] ? `${labels[log.taskSlug]} (${log.taskSlug})` : log.taskSlug} />
          <Row label="Step ID" value={log.taskID} />
          <Row label="Started" value={<span suppressHydrationWarning>{new Date(log.executedAt).toLocaleString()}</span>} />
          <Row label="Finished" value={<span suppressHydrationWarning>{new Date(log.completedAt).toLocaleString()}</span>} />
          <Row label="Duration" value={formatDuration(durationMs(log))} />
          {entry?.restored && <Row label="Note" value="This step succeeded in an earlier attempt. Payload reused its output and did not run it again." />}
          {node.kind === 'delay' && output?.continuedIn !== undefined && (
            <Row
              label="Continues in"
              value={<a href={`${adminRoute}/collections/payload-jobs/${output.continuedIn}/run`}>Job {output.continuedIn}</a>}
            />
          )}
        </dl>
      ) : isTrigger ? null : (
        <p className="pw-details__hint">{NOT_RUN[card.status ?? 'pending']}</p>
      )}

      {isTrigger && <Json label="Trigger data" value={visual?.trigger} />}
      <Json label="Input" value={log?.input} />
      <Json label="Output" value={log?.output} />
      <ErrorBlock error={log?.error} />
    </aside>
  )
}
