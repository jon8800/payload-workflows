'use client'

import { Button, toast, useConfig, useDocumentInfo, useFormModified } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type RunResponse = { error?: string; issues?: { message: string }[]; jobId?: number | string }

/** "Run now" on a workflow document. Queues a run with the trigger's test data and opens its Run tab. */
export function RunNowButton() {
  const { collectionSlug, id } = useDocumentInfo()
  const modified = useFormModified()
  const { config } = useConfig()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (!id) return null

  const run = async () => {
    setBusy(true)
    const response = await fetch(`${config.serverURL}${config.routes.api}/${collectionSlug}/${id}/run`, {
      credentials: 'include',
      method: 'POST',
    }).catch(() => null)
    const body = ((await response?.json().catch(() => null)) ?? {}) as RunResponse
    if (!response?.ok || body.jobId === undefined) {
      const first = body.issues?.[0]?.message
      toast.error([body.error ?? 'The workflow could not be started.', first].filter(Boolean).join(' '))
      setBusy(false)
      return
    }
    toast.success('Workflow started.')
    router.push(`${config.routes.admin}/collections/payload-jobs/${body.jobId}/run`)
  }

  return (
    <Button
      buttonStyle="secondary"
      disabled={busy || modified}
      margin={false}
      onClick={run}
      size="medium"
      tooltip={modified ? 'Save your changes first' : undefined}
    >
      {busy ? 'Starting…' : 'Run now'}
    </Button>
  )
}
