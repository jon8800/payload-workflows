'use client'

import { Button, CheckboxInput, SelectInput, TextareaInput, TextInput } from '@payloadcms/ui'
import { Cron } from 'croner'
import { useMemo, useRef, useState } from 'react'

import type { ValidationIssue } from '../../core/validate'
import type {
  CollectionOperation,
  ConditionNodeData,
  DelayNodeData,
  Rule,
  RuleGroup,
  TaskCatalogue,
  TaskInputField,
  TaskNodeData,
  TriggerData,
  WorkflowGraph,
  WorkflowNode,
} from '../../core/types'
import type { FlowNode } from './editorModel'
import type { CollectionChoice } from './WorkflowBuilder'

import { ancestors } from '../../core/graph'
import { RULE_OPERATORS } from '../../core/rules'
import { describeNode } from './describe'
import { NodeIcon } from './icons'

type Insert = (reference: string) => void

type InspectorProps = {
  catalogue: TaskCatalogue
  collections: CollectionChoice[]
  graph: WorkflowGraph
  issues: ValidationIssue[]
  node: null | WorkflowNode
  onChange: (id: string, data: FlowNode['data']) => void
  onDelete: (id: string) => void
  readOnly: boolean
}

type SelectOption = { label: string; value: string }

function selectValue(option: unknown): string | undefined {
  if (!option || Array.isArray(option)) return undefined
  return (option as { value?: string }).value
}

/** A text input that accepts literals and `{{references}}`. Remembers itself as the target for reference chips. */
function TemplateInput(props: {
  focus: (insert: Insert) => void
  label: string
  multiline?: boolean
  onChange: (value: string) => void
  path: string
  placeholder?: string
  readOnly: boolean
  required?: boolean
  value: unknown
}) {
  const { focus, label, multiline, onChange, path, placeholder, readOnly, required } = props
  const value = props.value === undefined || props.value === null ? '' : typeof props.value === 'string' ? props.value : JSON.stringify(props.value)
  const insert: Insert = (reference) => onChange(`${value}{{${reference}}}`)
  return (
    <div className="pw-input" onFocusCapture={() => focus(insert)}>
      {multiline ? (
        <TextareaInput label={label} onChange={(e) => onChange(e.target.value)} path={path} placeholder={placeholder} readOnly={readOnly} required={required} rows={3} value={value} />
      ) : (
        <TextInput label={label} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} path={path} placeholder={placeholder} readOnly={readOnly} required={required} value={value} />
      )}
    </div>
  )
}

const PLACEHOLDERS: Partial<Record<TaskInputField['type'], string>> = {
  date: '2026-01-31T09:00:00Z or {{reference}}',
  json: '{"key": "value"} or {{reference}}',
  number: '42 or {{reference}}',
  relationship: 'Document ID or {{reference}}',
}

function TaskFields({ data, field, focus, onChange, path, readOnly }: { data: TaskNodeData; field: TaskInputField; focus: (insert: Insert) => void; onChange: (value: unknown) => void; path: string; readOnly: boolean }) {
  const value = data.input?.[field.name]
  if (field.type === 'checkbox') {
    return (
      <div className="pw-input">
        <CheckboxInput checked={value === true || value === 'true'} label={field.label} name={path} onToggle={() => onChange(!(value === true || value === 'true'))} readOnly={readOnly} />
        {field.description && <p className="pw-help">{field.description}</p>}
      </div>
    )
  }
  if (field.type === 'select' && field.options && !field.hasMany) {
    return (
      <div className="pw-input">
        <SelectInput isClearable label={field.label} name={path} onChange={(option) => onChange(selectValue(option) ?? '')} options={field.options} path={path} readOnly={readOnly} required={field.required} value={typeof value === 'string' ? value : ''} />
        {field.description && <p className="pw-help">{field.description}</p>}
      </div>
    )
  }
  return (
    <div>
      <TemplateInput
        focus={focus}
        label={field.label}
        multiline={field.type === 'textarea' || field.type === 'json'}
        onChange={onChange}
        path={path}
        placeholder={PLACEHOLDERS[field.type] ?? 'Text or {{reference}}'}
        readOnly={readOnly}
        required={field.required}
        value={value}
      />
      {field.description && <p className="pw-help">{field.description}</p>}
    </div>
  )
}

function RulesEditor({ focus, group, onChange, path, readOnly, title }: { focus: (insert: Insert) => void; group: RuleGroup; onChange: (group: RuleGroup) => void; path: string; readOnly: boolean; title: string }) {
  const rules = group.rules ?? []
  const setRule = (index: number, patch: Partial<Rule>) => onChange({ ...group, rules: rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) })
  return (
    <div className="pw-rules">
      <div className="pw-rules__head">
        <span className="pw-label">{title}</span>
        {rules.length > 1 && (
          <SelectInput
            isClearable={false}
            name={`${path}.match`}
            onChange={(option) => onChange({ ...group, match: selectValue(option) === 'any' ? 'any' : 'all' })}
            options={[
              { label: 'All rules match', value: 'all' },
              { label: 'Any rule matches', value: 'any' },
            ]}
            path={`${path}.match`}
            readOnly={readOnly}
            value={group.match ?? 'all'}
          />
        )}
      </div>
      {rules.map((rule, index) => {
        const operator = RULE_OPERATORS.find((op) => op.value === rule.operator)
        return (
          <div className="pw-rule" key={index}>
            <TemplateInput focus={focus} label="Value" onChange={(left) => setRule(index, { left })} path={`${path}.${index}.left`} placeholder="{{trigger.doc.status}}" readOnly={readOnly} value={rule.left} />
            <SelectInput
              isClearable={false}
              label="Check"
              name={`${path}.${index}.operator`}
              onChange={(option) => setRule(index, { operator: (selectValue(option) ?? 'equals') as Rule['operator'] })}
              options={RULE_OPERATORS.map((op) => ({ label: op.label, value: op.value }))}
              path={`${path}.${index}.operator`}
              readOnly={readOnly}
              value={rule.operator}
            />
            {operator?.needsRight !== false && (
              <TemplateInput focus={focus} label="Compare with" onChange={(right) => setRule(index, { right })} path={`${path}.${index}.right`} placeholder="published" readOnly={readOnly} value={rule.right} />
            )}
            <button className="pw-link pw-rule__remove" disabled={readOnly} onClick={() => onChange({ ...group, rules: rules.filter((_, i) => i !== index) })} type="button">
              Remove rule
            </button>
          </div>
        )
      })}
      <Button buttonStyle="secondary" disabled={readOnly} margin={false} onClick={() => onChange({ ...group, match: group.match ?? 'all', rules: [...rules, { left: '', operator: 'equals', right: '' }] })} size="small">
        Add rule
      </Button>
    </div>
  )
}

const TRIGGER_KINDS: SelectOption[] = [
  { label: 'Run manually', value: 'manual' },
  { label: 'On a schedule', value: 'schedule' },
  { label: 'When a document changes', value: 'collection' },
]

const OPERATIONS: { label: string; value: CollectionOperation }[] = [
  { label: 'Created', value: 'create' },
  { label: 'Updated', value: 'update' },
  { label: 'Deleted', value: 'delete' },
]

function nextRuns(cron: string | undefined, timezone: string | undefined): string[] | null {
  if (!cron?.trim()) return null
  try {
    return new Cron(cron, { paused: true, sloppyRanges: true, timezone: timezone || undefined }).nextRuns(3).map((date) => date.toLocaleString())
  } catch {
    return null
  }
}

function SampleData({ onChange, path, readOnly, value }: { onChange: (value: Record<string, unknown> | undefined) => void; path: string; readOnly: boolean; value: Record<string, unknown> | undefined }) {
  const [text, setText] = useState(() => (value ? JSON.stringify(value, null, 2) : ''))
  const [error, setError] = useState<null | string>(null)
  return (
    <div className="pw-input">
      <TextareaInput
        label="Test data for Run now"
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          if (!next.trim()) {
            setError(null)
            onChange(undefined)
            return
          }
          try {
            const parsed: unknown = JSON.parse(next)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
            setError(null)
            onChange(parsed as Record<string, unknown>)
          } catch {
            setError('Enter a JSON object, for example {"email": "a@example.com"}.')
          }
        }}
        path={path}
        placeholder='{"email": "a@example.com"}'
        readOnly={readOnly}
        rows={4}
        value={text}
      />
      <p className={error ? 'pw-help pw-help--error' : 'pw-help'}>{error ?? 'Available as {{trigger.data}} when you click Run now.'}</p>
    </div>
  )
}

function TriggerEditor({ collections, data, focus, onChange, path, readOnly }: { collections: CollectionChoice[]; data: TriggerData; focus: (insert: Insert) => void; onChange: (data: TriggerData) => void; path: string; readOnly: boolean }) {
  const runs = data.kind === 'schedule' ? nextRuns(data.cron, data.timezone) : null
  return (
    <>
      <SelectInput isClearable={false} label="Starts" name={`${path}.kind`} onChange={(option) => onChange({ ...data, kind: (selectValue(option) ?? 'manual') as TriggerData['kind'] })} options={TRIGGER_KINDS} path={`${path}.kind`} readOnly={readOnly} value={data.kind} />
      {data.kind === 'schedule' && (
        <>
          <div className="pw-input">
            <TextInput label="Cron expression" onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...data, cron: e.target.value })} path={`${path}.cron`} placeholder="0 9 * * 1-5" readOnly={readOnly} required value={data.cron ?? ''} />
            <p className="pw-help">
              Minute, hour, day of month, month, day of week. "0 9 * * 1-5" is 09:00 on weekdays.
            </p>
            {runs && (
              <p className="pw-help">
                Next runs: <span suppressHydrationWarning>{runs.join(' · ')}</span>
              </p>
            )}
          </div>
          <div className="pw-input">
            <TextInput label="Time zone" onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...data, timezone: e.target.value })} path={`${path}.timezone`} placeholder="Server time zone, or e.g. Europe/London" readOnly={readOnly} value={data.timezone ?? ''} />
          </div>
        </>
      )}
      {data.kind === 'collection' && (
        <>
          {collections.length === 0 ? (
            <p className="pw-help pw-help--error">No collections can start workflows. Add their slugs to the plugin's `collections` option.</p>
          ) : (
            <SelectInput label="Collection" name={`${path}.collection`} onChange={(option) => onChange({ ...data, collection: selectValue(option) })} options={collections.map((c) => ({ label: c.label, value: c.slug }))} path={`${path}.collection`} readOnly={readOnly} required value={data.collection ?? ''} />
          )}
          <div className="pw-input">
            <span className="pw-label">When a document is</span>
            <div className="pw-checks">
              {OPERATIONS.map((op) => {
                const checked = data.operations?.includes(op.value) ?? false
                return (
                  <CheckboxInput
                    checked={checked}
                    key={op.value}
                    label={op.label}
                    name={`${path}.operations.${op.value}`}
                    onToggle={() =>
                      onChange({ ...data, operations: checked ? (data.operations ?? []).filter((v) => v !== op.value) : [...(data.operations ?? []), op.value] })
                    }
                    readOnly={readOnly}
                  />
                )
              })}
            </div>
          </div>
          <RulesEditor focus={focus} group={data.filter ?? { match: 'all', rules: [] }} onChange={(filter) => onChange({ ...data, filter })} path={`${path}.filter`} readOnly={readOnly} title="Only when (optional)" />
        </>
      )}
      <SampleData onChange={(sampleData) => onChange({ ...data, sampleData })} path={`${path}.sampleData`} readOnly={readOnly} value={data.sampleData} />
    </>
  )
}

/** References that the selected node can use: trigger data, the workflow, and outputs of earlier steps. */
function useReferences(graph: WorkflowGraph, node: WorkflowNode, catalogue: TaskCatalogue, collections: CollectionChoice[]): string[] {
  return useMemo(() => {
    const trigger = graph.nodes.find((n) => n.type === 'trigger')
    const refs: string[] = []
    if (trigger?.type === 'trigger') {
      const data = trigger.data
      if (data.kind === 'collection') {
        const fields = collections.find((c) => c.slug === data.collection)?.fields ?? ['id']
        refs.push(...fields.map((name) => `trigger.doc.${name}`), 'trigger.operation', 'trigger.previousDoc')
      } else if (data.kind === 'schedule') {
        refs.push('trigger.scheduledFor', 'trigger.firedAt')
      } else {
        refs.push(...Object.keys(data.sampleData ?? {}).map((key) => `trigger.data.${key}`), 'trigger.user.email')
      }
    }
    if (node.type === 'trigger') return refs
    const upstream = ancestors(graph, node.id)
    for (const other of graph.nodes) {
      if (!upstream.has(other.id)) continue
      if (other.type === 'task') {
        const outputs = catalogue[other.data.task]?.outputs ?? []
        refs.push(...(outputs.length ? outputs.map((name) => `steps.${other.id}.output.${name}`) : [`steps.${other.id}.output`]))
      }
      if (other.type === 'condition') refs.push(`steps.${other.id}.output.result`)
    }
    refs.push('workflow.title')
    return refs
  }, [catalogue, collections, graph, node])
}

/** The right-hand panel: settings of the selected step, or the workflow's problems when nothing is selected. */
export function Inspector({ catalogue, collections, graph, issues, node, onChange, onDelete, readOnly }: InspectorProps) {
  const target = useRef<Insert | null>(null)
  const [hasTarget, setHasTarget] = useState(false)
  const focus = (insert: Insert) => {
    target.current = insert
    setHasTarget(true)
  }

  if (!node) {
    return (
      <aside className="pw-inspector">
        <h3 className="pw-inspector__title">Workflow</h3>
        <p className="pw-help">Drag a task from the left onto the canvas, then connect it by dragging from one handle to another. Select a step to set it up.</p>
        {issues.length === 0 ? (
          <p className="pw-ok">
            <span className="pw-dot pw-dot--succeeded" /> No problems found. Save, then enable the workflow or click Run now.
          </p>
        ) : (
          <ul className="pw-inspector__issues">
            {issues.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        )}
      </aside>
    )
  }

  return (
    <aside className="pw-inspector" key={node.id}>
      <NodeSettings
        catalogue={catalogue}
        collections={collections}
        focus={focus}
        graph={graph}
        hasTarget={hasTarget}
        insert={(reference) => target.current?.(reference)}
        issues={issues}
        node={node}
        onChange={onChange}
        onDelete={onDelete}
        readOnly={readOnly}
      />
    </aside>
  )
}

function NodeSettings(props: Omit<InspectorProps, 'node'> & { focus: (insert: Insert) => void; hasTarget: boolean; insert: Insert; node: WorkflowNode }) {
  const { catalogue, collections, focus, graph, hasTarget, insert, issues, node, onChange, onDelete, readOnly } = props
  const references = useReferences(graph, node, catalogue, collections)
  const path = `pw-${node.id}`
  const labels = Object.fromEntries(Object.values(catalogue).map((t) => [t.slug, t.label]))
  const defaultTitle = describeNode({ ...node, data: { ...node.data, label: '' } } as WorkflowNode, labels).title
  const set = (data: WorkflowNode['data']) => onChange(node.id, data as FlowNode['data'])

  return (
    <>
      <div className="pw-inspector__head">
        <span className={`pw-node__icon pw-node__icon--${node.type}`}>
          <NodeIcon type={node.type} />
        </span>
        <h3 className="pw-inspector__title">{node.data.label || defaultTitle}</h3>
      </div>
      {node.type !== 'trigger' && <p className="pw-help">Step ID: <code>{node.id}</code></p>}
      {issues.length > 0 && (
        <ul className="pw-inspector__issues">
          {issues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      )}

      <div className="pw-input">
        <TextInput label="Name" onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ ...node.data, label: e.target.value } as WorkflowNode['data'])} path={`${path}.label`} placeholder={defaultTitle} readOnly={readOnly} value={node.data.label ?? ''} />
      </div>

      {node.type === 'trigger' && <TriggerEditor collections={collections} data={node.data} focus={focus} onChange={set} path={path} readOnly={readOnly} />}

      {node.type === 'task' && (
        <>
          <SelectInput
            isClearable={false}
            label="Task"
            name={`${path}.task`}
            onChange={(option) => set({ ...node.data, task: selectValue(option) ?? node.data.task } satisfies TaskNodeData)}
            options={Object.values(catalogue).map((task) => ({ label: task.label, value: task.slug }))}
            path={`${path}.task`}
            readOnly={readOnly}
            value={node.data.task}
          />
          {(catalogue[node.data.task]?.fields ?? []).map((field) => (
            <TaskFields
              data={node.data as TaskNodeData}
              field={field}
              focus={focus}
              key={field.name}
              onChange={(value) => set({ ...node.data, input: { ...(node.data as TaskNodeData).input, [field.name]: value } } as TaskNodeData)}
              path={`${path}.input.${field.name}`}
              readOnly={readOnly}
            />
          ))}
          <div className="pw-input">
            <TextInput
              label="Retries"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const retries = e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value)) || 0)
                set({ ...node.data, retries } as TaskNodeData)
              }}
              path={`${path}.retries`}
              placeholder={`Task default: ${catalogue[node.data.task]?.retries ?? 0}`}
              readOnly={readOnly}
              value={node.data.retries === undefined ? '' : String(node.data.retries)}
            />
          </div>
        </>
      )}

      {node.type === 'condition' && (
        <RulesEditor focus={focus} group={node.data} onChange={(group) => set({ ...(node.data as ConditionNodeData), ...group })} path={`${path}.rules`} readOnly={readOnly} title="Go to Yes when" />
      )}

      {node.type === 'delay' && (
        <div className="pw-row">
          <TextInput label="Wait" onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ ...(node.data as DelayNodeData), amount: Number(e.target.value) || 0 })} path={`${path}.amount`} readOnly={readOnly} value={String(node.data.amount ?? '')} />
          <SelectInput
            isClearable={false}
            label="Unit"
            name={`${path}.unit`}
            onChange={(option) => set({ ...(node.data as DelayNodeData), unit: (selectValue(option) ?? 'minutes') as DelayNodeData['unit'] })}
            options={['seconds', 'minutes', 'hours', 'days'].map((unit) => ({ label: unit, value: unit }))}
            path={`${path}.unit`}
            readOnly={readOnly}
            value={node.data.unit}
          />
        </div>
      )}

      {references.length > 0 && node.type !== 'delay' && (
        <section className="pw-refs">
          <span className="pw-label">References</span>
          <p className="pw-help">{hasTarget ? 'Click one to add it to the field you edited last.' : 'Click into a field, then click a reference to add it.'}</p>
          <div className="pw-refs__list">
            {references.map((reference) => (
              <button className="pw-chip" disabled={readOnly || !hasTarget} key={reference} onClick={() => insert(reference)} onMouseDown={(e) => e.preventDefault()} type="button">
                {reference}
              </button>
            ))}
          </div>
        </section>
      )}

      {node.type !== 'trigger' && (
        <div className="pw-inspector__footer">
          <Button buttonStyle="secondary" disabled={readOnly} margin={false} onClick={() => onDelete(node.id)} size="small">
            Delete step
          </Button>
        </div>
      )}
    </>
  )
}
