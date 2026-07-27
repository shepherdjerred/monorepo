---
id: dpc-tracing-context-propagation-check
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-07-10_quality-waves-2-3.md
source_marker: false
---

# Verify mario-kart span-context propagation after discord-plays-core deploy

PR #1449 (discord-plays-core extraction) reconciled the two games' OTel init
paths: mario-kart previously called `contextManager.enable()` +
`context.setGlobalContextManager()` manually; the shared
`discord-plays-core` tracing module uses pokemon's NodeSDK-managed context
manager instead (the manual path had a documented duplicate-registration
boot hazard).

Both test suites pass, but context-manager behavior differences show up in
LIVE span propagation, not unit tests. After the first mario-kart deploy
containing discord-plays-core:

- Open Tempo and confirm mk64 spans still parent correctly (streamer spans
  under session spans, no orphaned root spans).
- Confirm `streamFfmpeg*` metrics still flow (StreamObserver hook path).

If propagation broke, the fix is in
`packages/discord-plays-core/src/observability/tracing.ts` (context-manager
registration), not in mk64.

## Remaining

- [ ] During an active Mario Kart session, inspect a representative trace and confirm streamer spans are children of the session span with no unexpected orphan roots.
- [ ] Confirm `streamFfmpeg*` metrics are present for the same session and record the trace ID, query window, and deployment version.
- [ ] If propagation is broken, return this item to implementation work in `discord-plays-core/src/observability/tracing.ts`.

## Comment Log

### 2026-07-27 — Awaiting-human audit

PR #1449 and the StreamObserver metrics are present in source. The outstanding
trace and metric checks are read-only production observations an agent can run.

### 2026-07-27 — Production observation

Prometheus retained `stream_ffmpeg_speed_ratio` samples for 13 Mario Kart pods
over the preceding seven days; the query ran at
`2026-07-27T19:44:37.622Z`. Tempo returned no
`service.name=discord-plays-mario-kart` trace in the current search window, so
there was no active-session trace with which to validate parenting or associate
the metrics. Keep this card open until a Mario Kart session produces a fresh
trace; historical metric presence alone does not satisfy the same-session
acceptance criteria.
