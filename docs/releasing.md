# Payload 4 prerelease

The `release/payload-v4-next` branch holds the Payload 4 line. It publishes to npm under the `next` tag. `main` and the npm `latest` tag stay on the Payload 3 line.

Current candidate: `payload-workflows@0.2.0-next.1`, for Payload `^4.0.0-beta.8`.

## Validation

Run with pnpm. `pnpm-workspace.yaml` selects Node `24.22.3`.

```powershell
pnpm install --frozen-lockfile
pnpm verify
node --test scripts/release-target.test.mjs
pnpm pack
```

Then check the dev app: delete `dev/dev.db`, run `pnpm dev:seed`, start `pnpm dev`, and open the workflows list, the builder and the Run tab of a few jobs, in light and dark mode.

## Publishing

Push tag `v<version>` (for example `v0.2.0-next.1`). The publish workflow uses npm trusted publishing through GitHub OIDC, so it needs no npm token. It checks the tag against `package.json` and publishes a prerelease with `--tag next`. Stable versions get `latest`.
