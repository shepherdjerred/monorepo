---
id: pr-fleet-live-ui
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# PR Fleet Controller — Live Web Dashboard

## Context

The PR fleet controller (`packages/pr-fleet-controller`) is understandable today
only through `pr:fleet:inspect` — a flat, redacted dump of `events.jsonl` that is
unreadable at ~400 events/run. This adds a **live web dashboard, auto-spawned by
`pr:fleet`**, whose primary value is a **per-PR detail view with everything
attached — model chat logs and the literal assistant reasoning — live**.
Redaction is unwanted (single-operator homelab); show full bodies
(secret/credential scrubbing stays).

Decisions: view-only; surface everything incl. live model reasoning; Vite+React
client (mirror `packages/docs-board`); auto-spawn (`--no-ui` opts out).

## Approach (three parts)

1. **`spans.jsonl` live-reasoning channel** — a best-effort
   `SpanJsonlExporter implements ObservabilityExporter` appends each
   `exportTracingEvent`/`onMetricEvent` to `<runDir>/spans.jsonl` (0600), added to
   `createObservabilityExporters()` in `mastra-runtime.ts`. Needed because
   `observability.duckdb` (the only home of message-level reasoning) is
   exclusively locked by the controller during a run. Unversioned mirror — NOT in
   `RunManifestSchema.files` or the hash chain; `inspect`/`replay` untouched.
   Best-effort: a write failure never aborts the run.
2. **Sidecar watcher** (controller package): `watch-tail.ts` (pure
   `splitAppendedLines`, `resolveLatestRunDirectory`), `watch-server.ts`
   (`Bun.serve({fetch: honoApp.fetch})` on 127.0.0.1: `serveStatic` the web dist,
   `/api/meta`, `/api/stream` SSE tailing `events.jsonl` + `spans.jsonl`),
   `watch-cli.ts` (`pr:fleet:watch`, default newest run, `--run/--port/--no-open`).
   Add `hono` dep.
3. **Web package** `packages/pr-fleet-controller/packages/web`
   (`@shepherdjerred/pr-fleet-web`, nested workspace member): Vite+React mirroring
   docs-board config. Pure tested `src/lib/fold.ts` reducer (event+span stream →
   `{run, fleet, prs}`); `PrList` + `PrDetail` (`EvidencePanel` + `Transcript`
   with inline reasoning); `useRunStream` (EventSource) + react-query for
   `/api/meta`. Imports shared Zod types from the controller via `workspace:*`.

## Wiring

- `run-recorder.ts`: `RunPaths.spans`. `cli.ts`: `--no-ui/--ui-port/--no-open`;
  spawn watcher `detached` after `createBootstrapRecorder`; kill via
  `process.kill(-pid,...)` in the memoized `finalizeRun`.
- Root `package.json`: `workspaces += web member`; `pr:fleet` ensures web build
  (turbo-cached) then starts; add `pr:fleet:watch`.
- Pin `react`/`react-dom` **19.2.8** exact; `vite ^8.0.11`,
  `@vitejs/plugin-react ^6.0.1`, `hono ^4.12.18`.

## Verification

- Unit: `watch-tail` (partial-line splitting) + `fold` (fixture stream → view).
- Post-hoc UI: `pr:fleet:watch --run <bundle>` → screenshot (synthesize a
  `spans.jsonl` fixture for reasoning until a fresh run exists).
- Live: `pr:fleet --model …` opens browser, updates as events+spans append;
  `--no-ui` suppresses; Ctrl-C tears the child down.

## Remaining

- [ ] Drive PR #1992 (`feature/pr-fleet-live-ui`) to green on Buildkite `bun run verify` — the backstop for repo-wide gates (Knip, react-version-sync, markdownlint) that cannot run locally — and fix forward on any red step.

## Session Log — 2026-08-03

### Done

- **PR #1992** (ready): `feature/pr-fleet-live-ui`, off `origin/main`.
- Part 1 — `src/span-jsonl-exporter.ts` (`SpanJsonlExporter`, Bun `FileSink`,
  best-effort); wired into `mastra-runtime.ts` `createObservabilityExporters`;
  `RunPaths.spans` in `run-recorder.ts`.
- Part 2 — `src/watch-tail.ts` (+ tests), `src/watch-server.ts` (`Bun.serve`:
  static `dist` + `/api/meta` + `/api/stream` SSE tailing events + spans),
  `src/watch-cli.ts` (`pr:fleet:watch`). No new deps (plain `Bun.serve`, not Hono).
- Part 3 — `packages/web` (`@shepherdjerred/pr-fleet-web`) Vite+React, mirrors
  docs-board; pure tested `src/lib/fold.ts`; header/pr-list/pr-detail/evidence/
  transcript components; `use-run-stream.ts` (`useSyncExternalStore`) + `use-meta.ts`.
- Wiring — `cli.ts` `--no-ui/--ui-port/--no-open`, detached spawn via
  `src/watch-supervisor.ts`, teardown in `finalizeRun`. Root `pr:fleet` /
  `pr:fleet:watch` build the client (turbo-cached) first. README + AGENTS.md updated.
- Scoped the controller tsconfig/eslint/test to exclude the nested web package.
- Verified: `turbo typecheck lint test` green for both packages; end-to-end
  browser demo (fleet overview, per-PR evidence, transcript, live-appended
  reasoning) — screenshots on the PR.

### Remaining

- Buildkite `bun run verify` on the PR is the backstop for repo-wide gates
  (Knip, react-version-sync, markdownlint across the tree) I could not run locally
  — watch it and fix forward if red.
- Optional follow-ups (not in v1): DuckDB-backed authoritative reasoning reader;
  browser-side steering (needs a control channel into the running controller).

### Caveats

- Live end-to-end against a real model needs a provider credential + macOS
  `sandbox-exec`; not exercised in CI.
- `spans.jsonl` line shape depends on Mastra's exported-span format; the client
  parses leniently. If Mastra changes the span shape, only the reasoning rows are
  affected, not events.
- The dashboard demo used a synthesized `spans.jsonl` over a real captured run
  (existing bundles predate the exporter).
