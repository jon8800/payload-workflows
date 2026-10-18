import { sqliteAdapter } from '@payloadcms/db-sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig, type WorkflowConfig } from 'payload'
import { workflowsPlugin } from 'payload-workflows'

import { Activity, Posts, Users } from './collections'
import { publishDigest, tasks } from './jobs/tasks'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export const DEV_USER = { email: 'dev@payloadcms.com', password: 'test' }

export default buildConfig({
  admin: {
    autoLogin: process.env.NODE_ENV === 'development' ? { ...DEV_USER, prefillOnly: false } : false,
    importMap: { baseDir: dirname },
    user: Users.slug,
  },
  collections: [Users, Posts, Activity],
  db: sqliteAdapter({ client: { url: process.env.DATABASE_URI || `file:${path.resolve(dirname, 'dev.db')}` } }),
  jobs: {
    tasks,
    workflows: [publishDigest as unknown as WorkflowConfig],
  },
  plugins: [workflowsPlugin({ collections: ['posts'] })],
  secret: process.env.PAYLOAD_SECRET || 'dev-secret-not-for-production',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
})
