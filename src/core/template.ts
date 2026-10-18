// A small template resolver for `{{path.to.value}}` references. It only reads own properties along a
// dotted path. It never evaluates code, and it refuses prototype keys.

const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g
const WHOLE_TEMPLATE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/
const SEGMENT = /^[\w$-]+$/
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

export const TEMPLATE_ROOTS = ['steps', 'trigger', 'workflow'] as const

/** Splits `steps.a1.output.items[0].name` into `['steps', 'a1', 'output', 'items', '0', 'name']`. */
export function parsePath(path: string): null | string[] {
  const segments = path
    .trim()
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
  if (segments.some((segment) => !SEGMENT.test(segment) || FORBIDDEN.has(segment))) return null
  if (!(TEMPLATE_ROOTS as readonly string[]).includes(segments[0]!)) return null
  return segments
}

export function readPath(source: unknown, path: string): unknown {
  const segments = parsePath(path)
  if (!segments) return undefined
  let current: unknown = source
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Resolves templates in a value. A string that is exactly one template keeps the referenced
 * value's type (a number stays a number, an object stays an object). Templates inside longer
 * strings are replaced with text. Arrays and plain objects are resolved deeply.
 */
export function resolveTemplates(value: unknown, context: unknown): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_TEMPLATE.exec(value)
    if (whole) return readPath(context, whole[1]!)
    return value.replace(TEMPLATE, (_, path: string) => stringify(readPath(context, path)))
  }
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, context))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveTemplates(item, context)]),
    )
  }
  return value
}

/** Lists every template path in a value, valid or not. */
export function findReferences(value: unknown): string[] {
  if (typeof value === 'string') return [...value.matchAll(TEMPLATE)].map((match) => match[1]!.trim())
  if (Array.isArray(value)) return value.flatMap(findReferences)
  if (value && typeof value === 'object') return Object.values(value).flatMap(findReferences)
  return []
}

/** The node id a `steps.<id>...` reference points at, or null for other roots. */
export function referencedStep(path: string): null | string {
  const segments = parsePath(path)
  if (!segments || segments[0] !== 'steps') return null
  return segments[1] ?? null
}
