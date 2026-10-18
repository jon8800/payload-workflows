'use client'

import { Handle, Position } from '@xyflow/react'

import type { NodeRunStatus } from '../../core/runs'
import type { WorkflowNodeType } from '../../core/types'

import { NodeIcon } from './icons'

export const STATUS_LABELS: Record<NodeRunStatus, string> = {
  earlier: 'Earlier job',
  failed: 'Failed',
  notReached: 'Not reached',
  pending: 'Pending',
  restored: 'Reused',
  skipped: 'Skipped',
  succeeded: 'Succeeded',
  waiting: 'Delayed',
}

export type NodeCardProps = {
  /** Hide handles (the run viewer is read-only). */
  hideHandles?: boolean
  issueCount?: number
  kind: 'step' | WorkflowNodeType
  meta?: string
  selected?: boolean
  status?: NodeRunStatus
  subtitle?: string
  title: string
}

const HANDLE_SIZE = { height: 10, width: 10 }

const KIND_LABELS = { condition: 'Condition', delay: 'Delay', step: 'Step', task: 'Task', trigger: 'Trigger' }

/** The card drawn for one node, in both the run viewer and the builder. */
export function NodeCard({ hideHandles, issueCount, kind, meta, selected, status, subtitle, title }: NodeCardProps) {
  const HANDLE = hideHandles ? { ...HANDLE_SIZE, opacity: 0 } : HANDLE_SIZE
  const className = [
    'pw-node',
    `pw-node--${kind}`,
    status ? `pw-node--status-${status}` : '',
    issueCount ? 'pw-node--invalid' : '',
    selected ? 'pw-node--selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className}>
      {kind !== 'trigger' && <Handle className="pw-handle" position={Position.Top} style={HANDLE} type="target" />}
      <div className="pw-node__head">
        <span className="pw-node__icon">
          <NodeIcon type={kind} />
        </span>
        <span className="pw-node__kind">{KIND_LABELS[kind]}</span>
        {status && <span className={`pw-status pw-status--${status}`}>{STATUS_LABELS[status]}</span>}
        {!status && issueCount ? (
          <span className="pw-status pw-status--failed">{issueCount === 1 ? '1 problem' : `${issueCount} problems`}</span>
        ) : null}
      </div>
      <div className="pw-node__title">{title}</div>
      {subtitle && <div className="pw-node__subtitle">{subtitle}</div>}
      {meta && <div className="pw-node__meta">{meta}</div>}
      {kind === 'condition' ? (
        <>
          <Handle className="pw-handle pw-handle--true" id="true" position={Position.Bottom} style={{ ...HANDLE, left: '30%' }} type="source" />
          <Handle className="pw-handle pw-handle--false" id="false" position={Position.Bottom} style={{ ...HANDLE, left: '70%' }} type="source" />
          <div className="pw-node__branches">
            <span>Yes</span>
            <span>No</span>
          </div>
        </>
      ) : (
        <Handle className="pw-handle" position={Position.Bottom} style={HANDLE} type="source" />
      )}
    </div>
  )
}
