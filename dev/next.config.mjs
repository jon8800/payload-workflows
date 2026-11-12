import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  // The dev app has no front end: send / to the admin panel.
  redirects: async () => [{ destination: '/admin', permanent: false, source: '/' }],
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
