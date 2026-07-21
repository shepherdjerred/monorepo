---
id: reference-completed-2026-05-16-trmnl-dashboard-correctness
type: reference
status: complete
board: false
---

# TRMNL Dashboard Correctness

## Summary

TRMNL dashboard data was rendering failed collectors as zero values and undercounting Home Assistant problem entities by using the capped display list as the metric. The fix separates real counts from display rows, makes collector failures visible, corrects Bugsink service connectivity, validates tokens, and adds regression tests for the gaps.

## Implementation Notes

- TRMNL payloads now include `generated_time`, formatted server-side with `DISPLAY_TIME_ZONE` defaulting to `America/Los_Angeles`.
- Home Assistant problem collection now filters benign domains to match the monitoring policy, returns full unavailable/low-battery counts, and separately caps display rows.
- Bugsink now defaults to `http://bugsink-bugsink-service.bugsink:8000/api/canonical/0` and no longer sends unsupported `status=unresolved`.
- Homelab templates render `ERR` for unknown Bugsink/PagerDuty collectors, show critical and warning alert counts, use `generated_time`, and display compact diagnostics.
- Bugsink `ALLOWED_HOSTS` includes internal service hostnames.
- `trmnl-dashboard-credentials` in 1Password was updated with validated Bugsink and PagerDuty tokens.

## Testing

- Added client tests for Home Assistant count/display separation, Bugsink pagination/filtering, and PagerDuty error behavior.
- Added collector tests for failure surfacing and storage mount filtering.
- Added cdk8s synth tests for TRMNL Bugsink URL and Bugsink internal hostnames.
- Made cdk8s lint dependencies explicit so `bun run lint` is reproducible in this package.

## Session Log — 2026-05-16

### Done

- Updated `packages/trmnl-dashboard` collectors, clients, payload types, templates, and diagnostics route.
- Updated `packages/homelab/src/cdk8s` TRMNL and Bugsink deployment config plus Home Assistant alert annotation filtering.
- Added regression tests in `packages/trmnl-dashboard/src/__tests__/clients.test.ts` and `packages/homelab/src/cdk8s/src/trmnl-dashboard-config.test.ts`.
- Updated `packages/homelab/src/cdk8s/package.json` and `bun.lock` so cdk8s lint can load the shared ESLint config.
- Validated and copied Bugsink/PagerDuty tokens into 1Password item `trmnl-dashboard-credentials`.
- Verified:
  - `bun run --filter='./packages/trmnl-dashboard' test`
  - `bun run --filter='./packages/trmnl-dashboard' typecheck`
  - `bun run --filter='./packages/trmnl-dashboard' lint`
  - `bun test src/trmnl-dashboard-config.test.ts` from `packages/homelab/src/cdk8s`
  - `bun run typecheck` from `packages/homelab/src/cdk8s`
  - `bun run lint` from `packages/homelab/src/cdk8s`

### Remaining

- Ship the repo changes through the normal image/chart/ArgoCD path so live TRMNL uses the corrected code and Bugsink URL.
- After deploy, query `/api/homelab`, `/api/home`, and `/api/diagnostics` from the live pod to confirm PagerDuty/Bugsink no longer report `unknown`.

### Caveats

- Live TRMNL will not fully reflect the code fixes until the new image and cdk8s manifests deploy.
- `mise` emitted non-fatal warnings about tracking config symlinks under `~/.local/state/mise`; checks still completed successfully.

## Session Log — 2026-05-17

### Done

- Fixed Prettier issues in the TRMNL dashboard TypeScript files that blocked the first commit attempt.
- Installed locked `packages/homelab` dependencies so the pre-commit Homelab ESLint hook can resolve its package-local ESLint stack.
- Re-ran targeted verification:
  - `bunx markdownlint-cli2 packages/docs/plans/2026-05-16_trmnl-dashboard-correctness.md`
  - `bunx eslint --fix ...` from `packages/homelab`
  - `bun run --filter='./packages/trmnl-dashboard' test`
  - `bun run --filter='./packages/trmnl-dashboard' typecheck`
  - `bun run --filter='./packages/trmnl-dashboard' lint`
  - `bun test src/trmnl-dashboard-config.test.ts` from `packages/homelab/src/cdk8s`
  - `bun run typecheck` from `packages/homelab/src/cdk8s`
  - `bun run lint` from `packages/homelab/src/cdk8s`
- Committed and pushed `codex/trmnl-dashboard-correctness`.
- Opened draft PR [#836](https://github.com/shepherdjerred/monorepo/pull/836).

### Remaining

- Deploy the resulting image and manifests, then verify live `/api/home`, `/api/homelab`, and `/api/diagnostics`.

### Caveats

- The code and config changes are validated locally, but live dashboard correctness still depends on the normal deployment path.
