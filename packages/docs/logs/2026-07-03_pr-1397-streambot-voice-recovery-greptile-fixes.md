---
id: log-2026-07-03-pr-1397-streambot-voice-recovery-greptile-fixes
type: log
status: complete
board: false
---

# PR #1397 — streambot voice-recovery Greptile review fixes

## Context

Babysitting PR #1397 (`feat(streambot): auto-reconnect and resume after Discord
voice-session drops`, branch `feature/streambot-voice-robustness`) to green. The
Buildkite build #5003 failed on the `:mag: Greptile Review` gate
(`scripts/ci/src/wait-for-greptile.ts`) — not a CI flake, but 3 real unresolved
Greptile comments on `packages/streambot/src/session/voice-recovery.ts`.

## The three comments and fixes (commit 279db77)

| Sev | Loc                   | Problem                                                                                                                                                                                                                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                                                         |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | voice-recovery.ts:343 | `no-userbot` (a member userbot exists but is busy serving another stream — pool saturation) passed `attempts: attempt` (already incremented) to the next `scheduleReconnect`, burning the reconnect budget without ever attempting a rejoin. Three saturated 5s windows exhausted `maxAttempts` and fired the "couldn't reconnect" announcement, misattributing pool saturation as a rejoin failure. | Re-arm with `attempts: recovery.attempts` (budget NOT consumed) and wait for a slot to free up. Naturally bounded by `resumeMaxAgeSeconds` file expiry (`loadState` → `"nothing"`), so it backs off instead of looping forever. Metric outcome `no-userbot` (was `failed`). |
| P2  | voice-recovery.ts:332 | `"nothing"` (empty queue) and `"unresumable"` (no member userbot registered for the guild — structural/permanent) both incremented `voiceReconnectsTotal{outcome="skipped"}`, so dashboards can't distinguish harmless from broken.                                                                                                                                                                  | `"nothing"` stays `skipped`; `"unresumable"` gets its own `outcome: "unresumable"`. Updated the metric help string in `metrics.ts`.                                                                                                                                         |
| P2  | voice-recovery.ts:83  | Exhausted announcement said "or use /stream play to resume now", but `ensureForPlay` spawns a fresh session with `resumeKey: null` and never re-reads the preserved state file; only a restart (`resumeAll`) resumes it. Misleading.                                                                                                                                                                 | Dropped the clause: "Playback state is saved — it will resume automatically on the next restart."                                                                                                                                                                           |

## Files changed

- `packages/streambot/src/session/voice-recovery.ts` — the three fixes above.
- `packages/streambot/src/observability/metrics.ts` — metric help string lists
  the new `unresumable` / `no-userbot` outcomes.
- `packages/streambot/test/session-manager.test.ts` — rewrote the
  "no free userbot" recovery test to assert the pool-saturation wait/resume
  behavior (waits without burning budget → resumes once a userbot frees, no
  exhaustion announcement) instead of the old exhaustion path.
- `packages/streambot/test/voice-recovery.test.ts` — updated the exhausted-
  announcement assertion (no `/stream play`; promises restart-time resume).

## Verification (local)

- `bun run typecheck` — clean.
- `bunx eslint` on all 4 changed files — clean.
- `bun test test/voice-recovery.test.ts test/session-manager.test.ts` — pass.
  New test logs confirm: three "no userbot free to resume (will retry)" windows
  with no exhaustion, then resume at `attempt: 1` (budget preserved).
- Remaining 6 `bun test` failures are all `subtitles.integration.test.ts` — a
  local ffmpeg missing the libass `subtitles` filter; environment-only,
  unrelated to this change.
