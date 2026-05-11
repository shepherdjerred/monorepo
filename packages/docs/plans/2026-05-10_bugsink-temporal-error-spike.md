# Bugsink/Temporal Error Spike Investigation

## Status

Partially Complete

## Intent

Correlate the current Bugsink influx with Temporal and Kubernetes state after the Talos/Kubernetes API interruption.

## Scope

- Query current Bugsink unresolved/recent issues and identify which project is spiking.
- Check Temporal worker/server pod health, recent logs, and recent failed/timed-out workflow executions.
- Distinguish transient restart fallout from a persistent application bug or storage/queue backlog.

## Verification

- `toolkit bugsink ...`
- `kubectl` read-only checks in `bugsink` and `temporal`
- Temporal CLI read-only workflow/status queries through `kubectl exec`

## Session Log — 2026-05-10

### Done

- Confirmed Bugsink project `Temporal` (`id=12`) had the spike, mostly from PR review/summary workflows failing with Anthropic API low-credit errors.
- Confirmed the live cluster recovered: Bugsink and Temporal pods were running, and Temporal cluster health reported `SERVING`.
- Added stable Bugsink/Sentry grouping for Anthropic low-credit errors in Temporal PR review summary and specialist activities.
- Changed the Temporal worker Home Assistant event bridge startup into a retrying background supervisor so a transient WebSocket failure does not kill all Temporal task queues.
- Fixed the existing Temporal ESLint issue in `verify-runner.ts`.
- Verified with `bun run --filter='./packages/temporal' typecheck`, `bun run --filter='./packages/temporal' test`, and `cd packages/temporal && bunx eslint . --fix`.
- Published draft PR [#771](https://github.com/shepherdjerred/monorepo/pull/771) from branch `codex/temporal-bugsink-spike`.

### Remaining

- Deploy the Temporal changes.
- Fix the underlying Anthropic account/configuration problem by adding credits, switching provider/model configuration, or disabling those PR workflows until credentials are usable.
- After deploy, resolve or merge the duplicated low-credit Bugsink issues once new events group under the stable fingerprint.

### Caveats

- The code mitigation reduces worker fragility and future Bugsink issue cardinality; it does not make Anthropic API calls succeed while the account has no usable credit balance.
- `toolkit bugsink issues --project temporal` failed because the CLI path expected a numeric project id; `--project 12` worked.
