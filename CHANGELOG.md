# Changelog

## 0.2.0-next.0 - 2026-10-20

- Targets Payload and @payloadcms/ui 4.0.0-beta.3 only.
- Requires Node >=24.15.0, Next.js ^16.4.2, and TypeScript >=6.0.3.
- Updates the builder and run viewer to v4 UI controls and semantic CSS variables.
- Preserves the request and access checks when users run a workflow manually.
- Explicitly authorizes trusted scheduled runs, collection triggers, and delayed continuations without an interactive user.
- Reads v4 processingUntil leases to show running jobs correctly.
- Uses standalone task input/output types instead of host-generated task names.
- Keeps the stored workflow graph format unchanged.
- Publishes prereleases to next after checking the Git tag against package.json. The latest tag remains on the Payload 3 release.
