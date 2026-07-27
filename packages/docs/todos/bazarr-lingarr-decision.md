---
id: bazarr-lingarr-decision
type: todo
status: planned
board: true
verification: agent
disposition: deferred
origin: packages/docs/archive/superseded/2026-06-27_bazarr-subtitles-chinese-gating.md
source_marker: false
---

# Decide whether Lingarr belongs in the subtitle stack

Lingarr was an optional, unresolved extension in the original Bazarr plan. It
must not be deployed as an implicit prerequisite for Chinese subtitle gating.

## Remaining

- [ ] Reassess Lingarr only after the Whisper and provider-gating records are complete and measured.
- [ ] Compare the residual translation gap, maintenance/security cost, model resource use, and overlap with Bazarr/Whisper.
- [ ] Record an explicit adopt-or-reject decision with rollback and ownership if adoption is justified.
- [ ] If adopted, create a separate implementation plan rather than expanding this decision record.

## Comment Log

- 2026-07-27 — Split from the monolithic subtitle plan and classified deferred.
  No current evidence shows Lingarr is necessary; the core configuration work
  should establish the residual need first.
