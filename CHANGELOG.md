# Changelog

## 0.2.0-next.1 - 2026-11-12

For Payload 4. Install with `payload-workflows@next`.

- Targets Payload and `@payloadcms/ui` `^4.0.0-beta.8` (was pinned to beta.3). Requires Node `>=24.22.1` and React `^19.3.1`.
- No longer needs `sass` in your app: the admin styles ship as plain CSS that uses Payload 4's `--color-*` tokens.
- No longer imports Next.js: "Run now" uses Payload's framework-agnostic router, so `next` is no longer a peer dependency.
- Cron expressions follow Payload 4's strict rules. A step needs `*` or a range before the `/` (`*/10`, `5-59/15`). The builder reports `/10` or `5/15` as a problem, and such a workflow cannot be enabled.
- The workflows collection sets `versions: false`. Payload 4 turns versions on by default, and the scheduler's `nextRunAt` update would add a version on every run. Authorship (`createdBy` / `updatedBy`) stays on.
- Fixes the trigger panel in the builder: the "Starts" select stretched and left a large empty gap under it.
- Your own tasks: Payload 4 checks Local API access by default. Scheduled and collection-triggered runs have no user, so tasks that read or write documents need `overrideAccess: true`.
- SQL databases: Payload 4 adds jobs columns (`processingUntil`, `processingToken`, `concurrencyKey`, `meta`) and the `payload-jobs-stats` global, and the workflows collection gains `createdBy` / `updatedBy`. Generate a migration for production.
- Keeps the stored workflow graph format unchanged.

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
