---
id: dpc-tracing-context-propagation-check
type: todo
status: awaiting-human
board: true
verification: human
disposition: active
origin: packages/docs/plans/2026-07-10_quality-waves-2-3.md
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

## Human Verification

- Verify `Verify mario-kart span-context propagation after discord-plays-core deploy` in its intended environment and record evidence in the Comment Log.
