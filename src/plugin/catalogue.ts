import type { Field, TaskConfig } from 'payload'

import type { TaskCatalogue, TaskInputField } from '../core/types'

export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'en' in value && typeof value.en === 'string') return value.en
  return undefined
}

function inputType(field: Field): TaskInputField['type'] {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'number':
    case 'checkbox':
    case 'date':
      return field.type
    case 'select':
    case 'radio':
      return 'select'
    case 'relationship':
    case 'upload':
      return 'relationship'
    case 'code':
      return 'textarea'
    default:
      return 'json'
  }
}

/** Flattens an `inputSchema` into the top-level named fields the editor shows. */
export function toInputFields(fields: Field[] | undefined): TaskInputField[] {
  const result: TaskInputField[] = []
  for (const field of fields ?? []) {
    if (field.type === 'ui') continue
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        if ('name' in tab && tab.name) {
          result.push({ label: text(tab.label) ?? humanize(tab.name), name: tab.name, required: false, type: 'json' })
        } else {
          result.push(...toInputFields(tab.fields))
        }
      }
      continue
    }
    if (!('name' in field) || !field.name) {
      if ('fields' in field) result.push(...toInputFields(field.fields))
      continue
    }
    const entry: TaskInputField = {
      label: text('label' in field ? field.label : undefined) ?? humanize(field.name),
      name: field.name,
      required: 'required' in field ? Boolean(field.required) : false,
      type: inputType(field),
    }
    const description = text(field.admin && 'description' in field.admin ? field.admin.description : undefined)
    if (description) entry.description = description
    if ((field.type === 'select' || field.type === 'radio') && Array.isArray(field.options)) {
      entry.options = field.options.map((option) =>
        typeof option === 'string' ? { label: option, value: option } : { label: text(option.label) ?? option.value, value: option.value },
      )
    }
    if ('hasMany' in field && field.hasMany) entry.hasMany = true
    if (field.type === 'relationship' || field.type === 'upload') entry.relationTo = field.relationTo as string | string[]
    result.push(entry)
  }
  return result
}

function outputNames(fields: Field[] | undefined): string[] {
  return (fields ?? []).flatMap((field) => {
    if ('name' in field && field.name) return [field.name]
    if ('fields' in field) return outputNames(field.fields)
    return []
  })
}

/** Builds the list of tasks the builder can place, from the tasks registered in the Payload config. */
export function buildCatalogue(tasks: TaskConfig[] | undefined, include: (task: TaskConfig) => boolean = () => true): TaskCatalogue {
  const catalogue: TaskCatalogue = {}
  for (const task of tasks ?? []) {
    if (!include(task)) continue
    catalogue[task.slug] = {
      fields: toInputFields(task.inputSchema),
      label: task.label ?? humanize(task.slug),
      outputs: outputNames(task.outputSchema),
      retries: typeof task.retries === 'number' ? task.retries : task.retries?.attempts,
      slug: task.slug,
    }
  }
  return catalogue
}
