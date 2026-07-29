---
id: log-2026-07-27-bugsink-resolve-fixed-issues
type: log
status: complete
board: false
---

# Bugsink — resolve already-fixed issues

## Done

Resolved **46** unresolved Bugsink issues via the web UI bulk-action form
(`action=resolved_next`) after Django login. Verified each UUID
`is_resolved: true` via the canonical API.

| Project                  | Count | Reasons                                                                                                                                                              |
| ------------------------ | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scout-for-lol            |    42 | S3 `trackedplayers` header (15), S3 signature mismatch (22), Riot 520/generic upstream (2), filters skew (1), Pinterest `Load failed` (1), spectator circuit WAI (1) |
| discord-plays-pokemon    |     1 | CI smoke dummy-token (SENTRY_DSN cleared)                                                                                                                            |
| discord-plays-mario-kart |     1 | CI smoke dummy-token                                                                                                                                                 |
| tasknotes-app            |     2 | React version mismatch (fixed #1623)                                                                                                                                 |

S3 fix shipped in #1633; prod is on `2.0.0-6529` (last S3 events were `release=5991`).

## Remaining (not resolved this session)

Still-open clusters: Temporal glitter worker poller, Temporal agent Codex 401 /
Claude exits, Scout Zod competition status, Scout Prisma timeout, BSC 404,
Streambot interaction ack, Monaco `Canceled`, ffmpeg one-off, etc.

## Session Log — 2026-07-27

### Done

- Enumerated open issues; classified fixed vs active.
- Logged into `bugsink.sjer.red` (1P item `bugsink`) and bulk-resolved 46 issues.
- API-verified all 46 `is_resolved: true`.

### Remaining

- Active clusters still need code/ops fixes (see triage earlier in chat).

### Caveats

- Resolve does not prevent recurrence; regressions reopen on the next matching event.
- Left Scout pre-match lock timeout open (ops signal, not confirmed fixed).
