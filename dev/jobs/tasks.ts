import type { TaskConfig, WorkflowConfig } from 'payload'

// Example tasks for the dev app. They are realistic in shape but have no side effects outside the
// database: "Send email" writes to the log, and "HTTP request" does not call the network.

const collectionOptions = [
  { label: 'Activity', value: 'activity' },
  { label: 'Posts', value: 'posts' },
]

export const sendEmail = {
  slug: 'sendEmail',
  label: 'Send email',
  inputSchema: [
    { name: 'to', type: 'email', required: true },
    { name: 'subject', type: 'text', required: true },
    { name: 'body', type: 'textarea' },
  ],
  outputSchema: [{ name: 'messageId', type: 'text', required: true }],
  retries: 2,
  handler: async ({ input, req }) => {
    req.payload.logger.info(`[sendEmail] to ${input.to}: ${input.subject}`)
    return { output: { messageId: `dev-${Date.now().toString(36)}` } }
  },
} satisfies TaskConfig<'sendEmail'>

export const createDocument = {
  slug: 'createDocument',
  label: 'Create document',
  inputSchema: [
    { name: 'collection', type: 'select', options: collectionOptions, required: true },
    { name: 'data', type: 'json', required: true, admin: { description: 'The new document as JSON.' } },
  ],
  outputSchema: [{ name: 'id', type: 'text', required: true }],
  handler: async ({ input, req }) => {
    const doc = await req.payload.create({ collection: input.collection as 'activity', data: input.data as never, req })
    return { output: { id: String(doc.id) } }
  },
} satisfies TaskConfig<'createDocument'>

export const updateDocument = {
  slug: 'updateDocument',
  label: 'Update document',
  inputSchema: [
    { name: 'collection', type: 'select', options: collectionOptions, required: true },
    { name: 'id', type: 'text', required: true },
    { name: 'data', type: 'json', required: true, admin: { description: 'Only the fields to change.' } },
  ],
  outputSchema: [
    { name: 'id', type: 'text', required: true },
    { name: 'updatedAt', type: 'text' },
  ],
  handler: async ({ input, req }) => {
    const doc = await req.payload.update({ collection: input.collection as 'posts', data: input.data as never, id: input.id, req })
    return { output: { id: String(doc.id), updatedAt: doc.updatedAt } }
  },
} satisfies TaskConfig<'updateDocument'>

export const httpRequest = {
  slug: 'httpRequest',
  label: 'HTTP request',
  inputSchema: [
    { name: 'url', type: 'text', required: true },
    { name: 'method', type: 'select', defaultValue: 'POST', options: ['GET', 'POST', 'PUT', 'DELETE'] },
    { name: 'body', type: 'json' },
    {
      name: 'simulateFailure',
      type: 'checkbox',
      admin: { description: 'Fail the first attempt, to see retries in the run viewer.' },
    },
  ],
  outputSchema: [
    { name: 'status', type: 'number', required: true },
    { name: 'ok', type: 'checkbox' },
  ],
  retries: 2,
  handler: async ({ input, job, req }) => {
    if (input.simulateFailure && (job.totalTried ?? 0) === 0) {
      throw new Error(`Simulated failure: ${input.url} answered 503 Service Unavailable`)
    }
    req.payload.logger.info(`[httpRequest] ${input.method ?? 'POST'} ${input.url} (stub, no network call)`)
    return { output: { ok: true, status: 200 } }
  },
} satisfies TaskConfig<'httpRequest'>

/** A code-defined workflow, to compare with visual ones in the run viewer. */
export const publishDigest: WorkflowConfig<'publishDigest'> = {
  slug: 'publishDigest',
  label: 'Publish digest',
  inputSchema: [{ name: 'postId', type: 'text', required: true }],
  retries: 2,
  handler: async ({ job, tasks }) => {
    const activity = await tasks.createDocument('record-activity', {
      input: { collection: 'activity', data: { message: `Digest started for post ${job.input.postId}` } },
    })
    const ping = await tasks.httpRequest('notify-webhook', {
      input: { method: 'POST', simulateFailure: true, url: 'https://hooks.example.com/digest' },
    })
    await tasks.sendEmail('email-team', {
      input: { body: `The webhook answered ${ping.status}.`, subject: `Digest ready (activity ${activity.id})`, to: 'team@example.com' },
    })
  },
}

export const tasks = [sendEmail, createDocument, updateDocument, httpRequest] as unknown as TaskConfig[]
