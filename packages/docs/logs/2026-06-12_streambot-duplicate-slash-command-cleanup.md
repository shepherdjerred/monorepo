---
id: log-2026-06-12-streambot-duplicate-slash-command-cleanup
type: log
status: complete
board: false
---

# Streambot duplicate `/stream` slash command — live cleanup + prevention

## Problem

Two identical `/stream` entries in the Discord command picker (first diagnosed in a 2026-06-07
session that stalled on 1Password auth and never executed the fix). Root cause: the command exists
in **two Discord scopes at once** — Discord stores guild-scoped and global application commands in
separate buckets, and a `PUT` to one never clears the other.

- Deployed `main` registers `/stream` **guild-scoped** (`packages/streambot/src/discord/command-bot.ts`).
- The multi-server branch (PR #1115, `claude/relaxed-brahmagupta-25b0cc`) registers **globally**;
  at some point it ran against the production bot token and created the global copy.

## Live cleanup (done 2026-06-12)

Confirmed via the Discord API (creds from the `streambot-config` 1Password item; app
`1512990470202982560`, guild `208425771172102144`) that `/stream` existed in **both** buckets, then
cleared the **global** bucket (`PUT /applications/{appId}/commands` body `[]`) since prod runs the
guild-scoped `main`. Verified after: global empty, guild still has `/stream`. Global propagation can
lag up to ~1 hour.

## Prevention (PR #1115)

PR #1115 would have recreated the duplicate on deploy: it PUTs global commands but never empties the
guild buckets. Added cleanup to `CommandBot.register()` — after global registration, `PUT []` to
`Routes.applicationGuildCommands` for every guild in the client cache. Commit `7b0ccdadf` on the PR
branch. Also merged `origin/main` into the branch (`191bd68a6`) to refresh its stale base and rerun
the two flaky docker builds (birmel, discord-plays-mario-kart) that were the only red checks.

Verified in the `streambot-1115` worktree: streambot `tsc` clean, eslint clean, 221/222 tests pass.
The one failure is `integration/subtitles.integration.test.ts`, which needs an ffmpeg built with
libass (`subtitles` filter); the local Homebrew ffmpeg 8.1.1 lacks it. The same suite is green in
CI's Linux image on this branch.

## Session Log — 2026-06-12

### Done

- Cleared the stray global `/stream` command from the production Discord application (live API
  cleanup; guild-scoped command untouched).
- `packages/streambot/src/discord/command-bot.ts` on PR #1115: clear stale guild-scoped commands
  after global registration (commit `7b0ccdadf`).
- Merged `origin/main` into the PR branch and pushed (`191bd68a6`) — fresh CI run triggered.
- Corrected the stale status in `packages/docs/plans/2026-06-07_streambot-observability.md`
  (PR #1105 merged 2026-06-08).

### Remaining

- PR #1115: wait for the fresh CI run (the two prior failures were unrelated flaky docker builds),
  then merge + deploy. After deploy, confirm the picker shows exactly one `/stream`.
- Post-deploy verifications from the merged streambot PRs are still outstanding (VAAPI throttling
  check, resume-across-restart, Grafana dashboard population, subtitle acceptance matrix) — see the
  respective plans in `packages/docs/plans/`.
- `kubectl delete namespace mk64-spike` (empty namespace left from the observability session).

### Caveats

- If the global command propagation lags, the duplicate may linger in clients for up to ~1 hour
  after the cleanup.
- The guild-bucket cleanup in #1115 runs once per startup against every cached guild; if the bot is
  ever re-invited with stale guild commands elsewhere, a restart heals it.
