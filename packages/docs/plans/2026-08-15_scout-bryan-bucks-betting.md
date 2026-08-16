---
id: plan-2026-08-15-scout-bryan-bucks-betting
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Bryan Bucks — friendly betting for Scout

## Goal

Let the friend group bet on each other's live ranked games, using the prematch
and postmatch messages Scout already sends.

**Scope: one server, effectively beta-only.** This is a private single-server
experiment, not a Scout-wide feature, and is not intended to become one. The new
`betting_enabled` flag is `false` by default and overridden `true` for exactly
one guild — the owner's — and that guild runs the beta bot, so in practice it
only ever appears in beta. That follows from which bot is in the guild rather
than from a second gate; there is deliberately no environment check, so one
override stays the whole answer to "is it on here?".

`/bb` is registered as a **guild command** for exactly the guilds the flag is on
for, so it never appears in anyone else's picker — a globally registered
flag-gated command would be a dead end everywhere else. The guild list is
derived from the flag registry (`listGuildsWithFlagEnabled`), so enabling the
flag somewhere new registers the command there with no second edit.

The surfaces that people who _can_ use it will see — command description, both
balance surfaces, the prematch footer, the settlement header — still state the
scope, so a balance here is never mistaken for something Scout-wide. The
wording is defined once as `BUCKS_SCOPE_TAG` / `BUCKS_SCOPE_NOTE` in
`betting/constants.ts`.

Bryan Bucks exchange at **1:10 Bucks:CAD, in person only**. Bryan lives in
rural Canada, so they are effectively unredeemable. That joke is the entire
prize structure — there is no monetary component and nothing transfers to real
goods.

## Shape

**Earning.** A Discord user linked to a tracked `Player` gets +1 BB for
finishing a ranked game, +1 more for winning, +1 more for being the game's MVP.

**Betting.** Buttons on the prematch message. The window closes ten minutes
after detection. Payouts are parimutuel: winners split the losing side's pool
pro-rata, with no house and no rake.

**Ledger.** Every Buck is explained — which match, what was predicted, what
happened, and who was in the game.

## Decisions

### Buttons, not `!bet`

Scout's Discord client requests only `Guilds`, `GuildVoiceStates`, and
`GuildModeration`. Message-content commands need the **privileged**
MessageContent intent, which requires Discord app verification at prod's guild
count. Buttons need no new gateway privileges.

Scout had **zero** component handling before this: `handleCommands` owned
`interactionCreate` and early-returned on anything that was not a chat-input
command. `discord/interactions.ts` is now the single registration.

### One pool per (match, guild); bets store a team

Every 5v5 outcome is the same binary event. With two tracked players on
opposite teams, "A wins" _is_ "B loses". One pool holds both framings without
splitting liquidity, while the UI still reads "bet LOSE on Jerred".

Pools and wallets are per guild because `Player`, `Subscription`, and the flag
are all per guild. Paying guild A's winners out of guild B's losers would be
wrong.

### Balance is a stored column

This is a deliberate departure from the `DmAuditLog` "derive, never store"
precedent, and the reason is mechanical rather than philosophical.

That rule exists because a counter written _after_ a non-transactional side
effect (a Discord send) goes stale when the write fails. Here the balance and
its ledger row are both local SQLite writes in one `$transaction`.

More decisively, a derived balance cannot be checked atomically on this stack:
`SELECT SUM(delta)` then `INSERT` is a read-then-write inside a WAL
transaction, and the libsql adapter opens a deferred `BEGIN`, so a concurrent
committer yields `SQLITE_BUSY_SNAPSHOT` — which `busy_timeout` does **not**
retry.

The invariant that replaces it: **the first statement of every mutating
transaction is a guarded conditional write.** It validates the precondition and
takes the write lock in one round trip. `reconcileBucksBalances` re-derives
from the ledger and _reports_ drift rather than correcting it.

### Settlement idempotency is `poolState`, not a marker table

`MatchAiAttempt` must be marked _before_ its call because OpenAI spend is
external and cannot join a database transaction. Every side effect here is
local, so the state transition commits _with_ the payouts. A separate marker
would reintroduce the "marked but didn't happen" window it exists to close.

### Settlement runs outside the Discord path

`settleAndAwardBucks` is called from `processMatchAndUpdatePlayers`, after the
S3 ingest gate and **outside** the `if (!silent)` block. `processMatch` returns
early when no channel is subscribed and when the match is older than
`MAX_DISCORD_ALERT_AGE_MS`, and is skipped entirely for silent backfill — but
Bucks are owed for the game regardless of whether a message is worth sending.

### The stale sweep is not optional

`voidStaleBettingPools` refunds any pool still unsettled six hours past its
close. Six hours is chosen against the `ActiveGame` TTL and
`MAX_DISCORD_ALERT_AGE_MS`, both three hours. Without it, a match that never
produces a post-match result silently destroys every stake in its pool.

### MVP is role-aware

KDA alone never names a support or a jungler. Six contributions (combat,
damage, objective, vision, utility, survival) are normalized as **per-team
share** — scale-free across game length and patch — and blended under
role-dependent weights. Jungle carries 0.42 across objective and vision;
utility carries 0.48 across vision and utility.

The existing `findMvpIndex` in the report package answers a different question
(which _tracked_ player gets the splash art) over a different model, and is
left alone.

### The prediction is free

`buildLoadingScreenData` already fetches ranks for all ten players.
`prediction-inputs.ts` consumes that structure and **never re-fetches** — the
prematch poll runs every 30 seconds across up to 50 players, so ten Riot calls
per game per poll would be thousands of requests a minute.

The formula is a logistic over rank delta, season win rate, recent form, and
champion form, with **no intercept**, so a symmetric lobby returns exactly
0.500. Per-term clamps bound the logit at 2.075, so the model tops out near 89%
rather than relying on the 95% safety clamp.

## Layout

Everything lives in `packages/scout-for-lol/packages/backend/src/betting/`, with
no barrel file. Shared Zod schemas are in
`packages/data/src/model/bryan-bucks.ts`.

Five Prisma models: `BucksAccount`, `BucksLedgerEntry`, `BucksBet`,
`BucksMatchPool`, `BucksMatchEarning`.

## Verification

- `bunx turbo run typecheck test lint --filter=@scout-for-lol/backend` — clean
- `bun test` — 1443 pass, 6 skip, 0 fail across 161 files

Pinned invariants:

- Concurrent clicks cannot overdraw a wallet, and a racing first bet seeds
  exactly one.
- Settling twice moves nothing and returns no summary the second time, which is
  what stops a duplicate announcement.
- Awarding the same match twice still totals +3 — the `recoverMissedMatches`
  regression guard.
- Payout conservation is asserted on _every_ parimutuel case.
- A 2/3/28 support with 90 vision score beats a 14/2/9 mid.
- A real 16-participant Arena fixture is refused.

## Remaining

- [ ] End-to-end run against the beta bot in a live guild: place bets from two
      accounts, let a ranked game finish, confirm the settlement message.
- [ ] Attach screenshots (prematch buttons, ephemeral confirmation, settlement,
      `/bb leaderboard`) to the PR before it leaves draft.
- [ ] Decide whether to keep the branch name, which predates the rename from
      "Virmel Points".

## Out of scope

Seasons, roles, and resets · a web dashboard leaderboard · autocomplete on
`/bb bet` · unifying `report/src/html/shared/grade.ts` · static champion-strength
priors · betting on ARAM or normals · an LLM prediction voice.
