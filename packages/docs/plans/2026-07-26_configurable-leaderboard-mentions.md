---
id: configurable-leaderboard-mentions
type: plan
status: in-progress
board: false
---

# Configurable top-N mentions for leaderboard reports

## Context

PR #1678 makes leaderboard report mentions configurable without a Prisma
migration or slash-command setting. The approved local plan used the existing
ScoutQL `RENDER <kind> WITH (...)` convention: `mentions = <n>` selects a
non-negative ranked-row count, `mentions = all` targets every returned row,
and `mentions = 0` is the opt-out. Bare `RENDER leaderboard` preserves the
default top-three behavior, including the seeded Common Denominator reports.

## Approved design

1. Add a strict `ReportLeaderboardOptionsSchema` with optional
   `mentions: number | "all"`, then give the `LEADERBOARD` render spec a
   defaulted options object.
2. Parse `RENDER leaderboard WITH (mentions = <n>|all)` separately from
   chart options. Unknown keys, negative values, fractional values, and empty
   values fail with a validation error.
3. Resolve the runtime count during leaderboard text rendering: unset means
   three, `all` means the returned-row count, and zero emits no mentions.
4. Keep configuration query-scoped. Do not add a database column, migration,
   or separate `/report create` or `/report update` parameter.
5. Document the syntax in the render-option registry and Scout's canonical
   `CLAUDE.md` integration guide.

## Additional review hardening

Codex review identified safety requirements beyond the original configurable
count plan:

- Carry an explicit player or player-group identity through report results;
  never infer a Discord recipient from a rendered label.
- Validate every non-null stored Discord account ID. Only `null` represents an
  intentionally unlinked player.
- Split oversized rendered report content at every Discord delivery path so
  expanded mentions cannot exceed the platform's message limit.

## Verification

- Data parser tests cover numeric, `all`, zero, invalid, and empty values.
- Backend integration tests cover default, explicit count, opt-out, player,
  player-group, and non-player label-collision behavior.
- Scoped data/backend typecheck, tests, lint, docs checks, and the independent
  merge-tree check run before submission.
