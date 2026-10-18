import type { WorkflowNode } from '../../core/types'

import { RULE_OPERATORS } from '../../core/rules'

export type TaskLabels = Record<string, string>

const TRIGGER_TITLES = { collection: 'When a document changes', manual: 'Run manually', schedule: 'On a schedule' }
const OPERATIONS = { create: 'created', delete: 'deleted', update: 'updated' }

function plural(amount: number, unit: string): string {
  const singular = unit.replace(/s$/, '')
  return `${amount} ${amount === 1 ? singular : unit}`
}

/** The title and the second line a node shows on the canvas. */
export function describeNode(node: WorkflowNode, labels: TaskLabels): { subtitle: string; title: string } {
  switch (node.type) {
    case 'trigger': {
      const { data } = node
      const title = data.label || TRIGGER_TITLES[data.kind]
      if (data.kind === 'schedule') return { subtitle: data.cron ? `Cron ${data.cron}` : 'No schedule set', title }
      if (data.kind === 'collection') {
        const ops = (data.operations ?? []).map((op) => OPERATIONS[op]).join(', ')
        return { subtitle: data.collection ? `${data.collection}: ${ops || 'no operations'}` : 'No collection set', title }
      }
      return { subtitle: 'Started with "Run now"', title }
    }
    case 'task':
      return { subtitle: node.data.task, title: node.data.label || labels[node.data.task] || node.data.task }
    case 'condition': {
      const first = node.data.rules?.[0]
      const operator = RULE_OPERATORS.find((op) => op.value === first?.operator)
      const summary = first ? `${first.left} ${operator?.label ?? ''} ${operator?.needsRight ? (first.right ?? '') : ''}`.trim() : 'No rules yet'
      const more = (node.data.rules?.length ?? 0) > 1 ? ` (+${node.data.rules.length - 1})` : ''
      return { subtitle: summary + more, title: node.data.label || 'Condition' }
    }
    case 'delay':
      return { subtitle: `Wait ${plural(node.data.amount, node.data.unit)}`, title: node.data.label || 'Delay' }
  }
}
