'use client'

import './styles.scss'

import { useField } from '@payloadcms/ui'
import { lazy, Suspense } from 'react'

import type { TaskCatalogue, WorkflowGraph } from '../../core/types'

const Editor = lazy(() => import('./Editor'))

/** A collection that can start workflows, with its top-level field names for `{{trigger.doc.<field>}}`. */
export type CollectionChoice = { fields: string[]; label: string; slug: string }

export type BuilderProps = {
  catalogue: TaskCatalogue
  collections: CollectionChoice[]
  path: string
  readOnly: boolean
}

/** The workflow's `graph` field. Loads the React Flow editor on demand. */
export function WorkflowBuilder({ catalogue, collections, path, readOnly }: BuilderProps) {
  const { errorMessage, setValue, showError, value } = useField<WorkflowGraph>({ path })

  return (
    <div className="pw-builder field-type">
      {showError && errorMessage && <div className="pw-builder__error">{errorMessage}</div>}
      <div className="pw-builder__frame">
        <Suspense fallback={null}>
          <Editor catalogue={catalogue} collections={collections} onChange={setValue} readOnly={readOnly} value={value} />
        </Suspense>
      </div>
    </div>
  )
}
