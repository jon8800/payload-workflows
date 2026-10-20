# Payload 4 prerelease

Candidate: `payload-workflows@0.2.0-next.0`, for Payload `4.0.0-beta.3` only.

This worktree starts at `f336b77` on `release/payload-v4-next`. The original checkout and the npm `latest` tag remain unchanged.

## Validation

Run from this worktree with pnpm. `pnpm-workspace.yaml` selects Node `24.15.0`.

```powershell
pnpm install --frozen-lockfile
pnpm verify
node --test scripts/release-target.test.mjs
pnpm build
pnpm pack
```

Package and dev app typechecks passed. Lint passed. All 41 plugin tests passed, including the original SQLite integration suite and new v4 regressions. All 3 release-channel tests passed. The compiled server and core exports load in native Node.

The inspected tarball contains 68 files. All four public exports point to existing `dist` files. It contains no test, fixture, source, dev, environment, or dependency folders. The existing package build excludes test files and preserves client directives and stylesheets.

## Publishing

After review, commit this worktree and push tag `v0.2.0-next.0`. The existing workflow uses npm trusted publishing through GitHub OIDC. It requires no npm token secret.

The workflow checks the Git tag against package.json. It publishes the exact packed filename with explicit `--tag next` for this prerelease. Stable versions derive `latest` instead. The current stable `latest` tag stays on `0.1.3`.

The parent task must complete the combined consumer build before release. This preparation does not commit, push, tag, or publish anything.
