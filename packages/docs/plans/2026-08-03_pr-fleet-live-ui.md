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
