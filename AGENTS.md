# payload-workflows

A Payload CMS 3 plugin with two parts: a **Run** tab on `payload-jobs` documents that draws a job as a React Flow graph, and a `workflows` collection with a visual builder whose workflows run on Payload's jobs queue. `README.md` is the user guide. `CLAUDE.md` is a stub that imports this file.

## Tech stack

- Payload 3.90, Next.js 16.3 (Turbopack), React 19.3, `@xyflow/react` 12, `croner` for cron
- TypeScript 7 (native compiler). No `baseUrl`; `paths` entries start with `./` or `../`.
- Oxlint (`.oxlintrc.json`). Must report 0 problems.
- Vitest. pnpm 10.
- Dev app: `dev/`, SQLite in `dev/dev.db`, Payload `push` in dev.

## Layout

```
src/
  core/        pure logic, no Payload or React imports: graph types, validation, templates,
               rules, the graph walker, log -> attempts, run status. Exported as `payload-workflows/core`.
  plugin/      server: options, the plugin function, workflows collection + Run now endpoint,
               the generic runner workflow, scheduler task, collection trigger hooks, task catalogue
  admin/
    server/    RSC: RunView (jobs tab), WorkflowBuilderField (the graph field)
    client/    client leaves. RunGraph and Editor import React Flow and are loaded with React.lazy.
  exports/     `payload-workflows/client` and `payload-workflows/rsc` (import-map entry points)
test/          integration test: runs visual workflows through Payload's local API (in-memory SQLite)
dev/           Payload + Next app for development, seed script, example tasks
scripts/       build-package.mjs (tsc -> dist, fixes import extensions, copies SCSS), check-publish, screenshots
```

## Rules

- **Admin UI:** SCSS under `@layer payload-default`, Payload CSS variables only, no Tailwind. Prefer `@payloadcms/ui` public exports over deep imports. Keep the admin layer thin: Payload 4 will change the admin UI.
- React Flow's stylesheet is not layered, so it beats our layered SCSS. Theme it through the CSS variables in `src/admin/client/flowTheme.ts` (set inline on the React Flow root) and inline `style` on edges and handles. Do not try to override `.react-flow__*` classes in SCSS.
- Only `RunGraph.tsx` and `Editor.tsx` may import `@xyflow/react` at module level (and `NodeCard.tsx`, which only they import). Everything else must stay light, because the import map loads it on every admin page.
- Server components by default; client components at the leaves.
- Plugin code must not depend on a host app's generated types. Cast Payload's typed APIs (`tasks`, `jobs.queue`) to plain shapes.
- Chain host config, never replace it: `jobsCollectionOverrides`, `autoRun`, collection hooks.
- `src/core/types.ts` is the stored workflow format. Change it deliberately: existing workflow documents and queued jobs hold this JSON.
- Files UTF-8 without BOM. On Windows, write files with the editor tools, not PowerShell `Set-Content`.
- Never run `payload migrate` on the dev database.
- Templates are resolved by `src/core/template.ts`: dotted paths only, own properties only, no prototype keys. Never add `eval`, `new Function` or user-supplied code.

## Commands

- `pnpm verify`: typecheck (package and dev app), lint, tests
- `pnpm test`: vitest (unit tests in `src/core`, integration in `test/`)
- `pnpm build`: `dist/`. `pnpm pack` runs the build and swaps in `publishConfig.exports`. Publish only with pnpm.
- `pnpm dev:seed`, then `pnpm dev`: http://localhost:3060/admin (auto-login `dev@payloadcms.com` / `test`)
- `pnpm dev:generate-importmap` after adding or renaming admin components; `pnpm dev:generate-types` after config changes
- `pnpm screenshots` with the dev app running: retakes `docs/screenshots/`. Look at every screenshot after UI changes.
