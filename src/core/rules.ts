import type { Rule, RuleGroup, RuleOperator } from './types'

import { resolveTemplates } from './template'

export const RULE_OPERATORS: { label: string; needsRight: boolean; value: RuleOperator }[] = [
  { label: 'equals', needsRight: true, value: 'equals' },
  { label: 'does not equal', needsRight: true, value: 'notEquals' },
  { label: 'contains', needsRight: true, value: 'contains' },
  { label: 'does not contain', needsRight: true, value: 'notContains' },
  { label: 'is greater than', needsRight: true, value: 'gt' },
  { label: 'is at least', needsRight: true, value: 'gte' },
  { label: 'is less than', needsRight: true, value: 'lt' },
  { label: 'is at most', needsRight: true, value: 'lte' },
  { label: 'has a value', needsRight: false, value: 'exists' },
  { label: 'is empty', needsRight: false, value: 'notExists' },
]

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

function asNumber(value: unknown): null | number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

function asComparable(value: unknown): null | number | string {
  const number = asNumber(value)
  if (number !== null) return number
  if (typeof value === 'string' && ISO_DATE.test(value)) {
    const time = Date.parse(value)
    if (!Number.isNaN(time)) return time
  }
  if (typeof value === 'string') return value
  return null
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function looselyEqual(left: unknown, right: unknown): boolean {
  const leftNumber = asNumber(left)
  const rightNumber = asNumber(right)
  if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber
  if (typeof left === 'boolean' || typeof right === 'boolean') return asText(left) === asText(right)
  return asText(left) === asText(right)
}

function contains(container: unknown, item: unknown): boolean {
  if (Array.isArray(container)) return container.some((entry) => looselyEqual(entry, item))
  return asText(container).includes(asText(item))
}

function order(left: unknown, right: unknown): null | number {
  const a = asComparable(left)
  const b = asComparable(right)
  if (a === null || b === null || typeof a !== typeof b) return null
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** Compares two already-resolved values. */
export function compare(left: unknown, operator: RuleOperator, right: unknown): boolean {
  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    const result = order(left, right)
    if (result === null) return false
    if (operator === 'gt') return result > 0
    if (operator === 'gte') return result >= 0
    if (operator === 'lt') return result < 0
    return result <= 0
  }
  switch (operator) {
    case 'equals':
      return looselyEqual(left, right)
    case 'notEquals':
      return !looselyEqual(left, right)
    case 'contains':
      return contains(left, right)
    case 'notContains':
      return !contains(left, right)
    case 'exists':
      return !isEmpty(left)
    case 'notExists':
      return isEmpty(left)
  }
  return false
}

export type RuleResult = { left: unknown; operator: RuleOperator; passed: boolean; right: unknown }

export function evaluateRule(rule: Rule, context: unknown): RuleResult {
  const left = resolveTemplates(rule.left, context)
  const right = resolveTemplates(rule.right ?? '', context)
  return { left, operator: rule.operator, passed: compare(left, rule.operator, right), right }
}

/** An empty group passes. `all` needs every rule to pass, `any` needs one. */
export function evaluateRules(group: RuleGroup | undefined, context: unknown): { passed: boolean; results: RuleResult[] } {
  const rules = group?.rules ?? []
  const results = rules.map((rule) => evaluateRule(rule, context))
  if (results.length === 0) return { passed: true, results }
  const passed = group?.match === 'any' ? results.some((r) => r.passed) : results.every((r) => r.passed)
  return { passed, results }
}
