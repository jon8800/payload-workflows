import type { JSONFieldServerProps } from 'payload'

import type { CollectionChoice } from '../client/WorkflowBuilder'

import { getOptions } from '../../plugin/options'
import { catalogueFor } from '../../plugin/runner'
import { WorkflowBuilder } from '../client/WorkflowBuilder'

function label(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'en' in value && typeof value.en === 'string') return value.en
  return fallback
}

/**
 * The `graph` field of a workflow, drawn as the visual builder. A server component, so it can read
 * the registered tasks from the Payload config and pass the editor a plain catalogue.
 */
export function WorkflowBuilderField(props: JSONFieldServerProps) {
  const { path, payload, readOnly } = props
  const options = getOptions(payload.config)
  const collections: CollectionChoice[] = options.collections.map((slug) => {
    const collection = payload.config.collections.find((c) => c.slug === slug)
    const fields = (collection?.flattenedFields ?? []).flatMap((field) => ('name' in field ? [field.name] : []))
    return { fields: ['id', ...fields.filter((name) => name !== 'id')], label: label(collection?.labels?.plural, slug), slug }
  })
  return (
    <WorkflowBuilder catalogue={catalogueFor(payload)} collections={collections} path={path} readOnly={Boolean(readOnly)} />
  )
}
