---
id: plan-2026-08-13-scout-explore-page
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Scout Explore — conversational queries over the whole report lake

## Goal

Give Scout a chat surface where a signed-in user asks questions in plain
language and gets a prose answer with an inline visualization, over every match
Scout has ingested rather than one Discord server's tracked players. Finished
conversations can be frozen and shared as public read-only links.

This is a limited rollout: access is Discord login plus an operator-managed
guild allowlist.

## Why the lake already supported this

`flattenMatch` maps `info.participants` with no tracked-player filter, and both
the staging fold and the nightly rebuild write every row. Match facts therefore
already hold one row per participant of every ingested match, including
`riot_id_game_name` / `riot_id_tagline`. The match and prematch parquet carry no
`server_id` column at all — the accounts dimension was the only thing narrowing
queries to one server.

## The decision that shaped everything

Global scope **drops the accounts join entirely** rather than removing its
`server_id` predicate.

Accounts rows are written per `(server_id, account)`, so an accounts join with
the predicate merely removed matches a PUUID once per server tracking it and
**doubles every aggregate** — silently, and only for the subset of players
tracked in more than one server. Not joining is what makes the global path
correct, not merely simpler. With no join there is nothing to fan out.

Consequences that follow from having no accounts dimension:

- Rows label themselves from the Riot ID on the match fact, and group by
  `puuid`. Guild aliases are per-server nicknames with no global meaning.
- `player_id` and `discord_id` are absent, so a global row resolves no Discord
  mention. `playerMentionIdentity` returns null when a row can address nobody.
- `player_groups` / `player_pairs` **refuse** global scope. A teammate group
  means "these tracked accounts queued together"; global facts cannot
  distinguish a premade from random matchmaking, so every match would report a
  five-stack. There is no correct answer to give.
- The competition sources refuse global scope: they authorize against an owning
  server and have no meaning without one.

## Shape

| Layer                | Location                                                                                |
| -------------------- | --------------------------------------------------------------------------------------- |
| Scope discriminant   | `backend/src/reports/duckdb/scope.ts`                                                   |
| Global compilation   | `backend/src/reports/duckdb/compile.ts`, `compile-grouping.ts`                          |
| Agent                | `backend/src/explore/{agent,prompt,stream}.ts`                                          |
| Shared ScoutQL tools | `backend/src/reports/ai/scoutql-tools.ts`                                               |
| Storage              | `backend/src/explore/store.ts`, `ExploreConversation` / `ExploreMessage`                |
| Access               | `backend/src/explore/access.ts`, `EXPLORE_GUILD_ALLOWLIST`                              |
| Quotas               | `backend/src/explore/rate-limit.ts` on `utils/quota-buckets.ts`                         |
| Routes               | `backend/src/explore/http-route.ts`, `trpc/router/explore.router.ts`                    |
| UI                   | `app/src/routes/explore.tsx`, `explore-shared.tsx`, `components/explore-transcript.tsx` |

`LakeQueryScope` is a discriminated union rather than an optional `serverId`: a
field that merely went missing would let a scheduled report widen to the whole
lake by accident. Global has to be asked for at every call site.

## Trust properties

The system prompt carries the two properties that decide whether this surface is
worth having:

1. **Never state a statistic not read from a query result this turn.** A
   confidently wrong win rate is indistinguishable from a right one to a reader,
   and it destroys trust in every other number on the page. Refusing is cheap.
2. **Describe the corpus honestly.** It is the matches Scout ingested — the
   games of tracked players and everyone who was in them — not the League
   ladder. The UI empty state says so too.

## Sharing

An assistant turn stores its rendered result inline (preview rows plus the
visualization snapshot). A shared conversation is therefore frozen by
construction: rendering needs no re-execution, an anonymous viewer costs no
query, and a link cannot quietly change meaning as the lake grows.

Frozen against the lake is not frozen against the owner, though: sharing again
re-pins `sharedLeafId` to the branch being read at the time, under the same
token, and revoking clears the token outright. `GET /api/explore/shared/:token`
is therefore the only unauthenticated route and answers `Cache-Control:
no-store` — a cached copy would keep serving a revoked conversation for the
life of its TTL, and withdrawing access has to be immediate to mean anything.

## Access

`EXPLORE_GUILD_ALLOWLIST` is the entire gate, so an empty or unset list denies
everyone. Every tRPC procedure re-checks it rather than trusting that the caller
passed when the conversation was created, so losing membership removes access to
conversations already saved.

## ChatGPT-parity pass

A follow-up pass on the same branch fixed one bug and closed the affordance
gaps that made the first cut read as a prototype.

**The bug:** answers streamed the raw JSON of the structured output. With
`structuredOutput` on, `text-delta` chunks carry JSON fragments — the report
editor renders its stream into a monospace scratch box precisely because of
this — and explore piped them into a prose paragraph. Mastra already emits
parsed `Partial<OUTPUT>` snapshots as `object` chunks on the same
`fullStream`, so the fix was one chunk kind and one case. Two silent-failure
modes are now pinned by tests: `answer` staying the first schema field, and
the stream loop draining rather than breaking.

**Turns became a tree.** Editing or regenerating appends a sibling instead of
truncating, `currentLeafId` selects the path on screen, and a share pins
`sharedLeafId` so branching afterwards cannot change what a link renders.
Regenerating forks the answer; editing forks the question.

**The UI** gained live markdown, version arrows, copy, edit, regenerate, a
collapsible tool trace, a stop button, a mobile drawer, title search, markdown
export, an auto-growing composer, and date-grouped conversations. Delete is
behind a real modal rather than the repo's usual `globalThis.confirm()`.

## Deliberately deferred

- **A restricted "global dialect."** The ScoutQL registry is a flat set of
  module-level constants with no dialect mechanism, and the compiler enforces
  the full set unconditionally, so hiding items from `get_report_language` alone
  would be cosmetic — the model could still emit them successfully. Doing it
  properly needs a registry projection _plus_ a matching compile-time rejection
  path. Not worth it for a trusted allowlist audience; revisit if explore opens
  to the public.
- **Marketing-site entry point.** Explore lives at `/app/explore`; a public
  landing page on the Astro site is a separate change.

## Verification

- `bunx turbo run typecheck test lint build --filter='@scout-for-lol/*'`.
- `reports/global-scope.integration.test.ts` executes real DuckDB and pins the
  fan-out property: an account tracked by two servers reports 3 games, not 6.
- `duckdb/compile-global.test.ts` pins the SQL shape (no accounts CTE, no
  `server_id`, `GROUP BY puuid`, compiles without `accounts.parquet`).
- `explore/store.integration.test.ts`, `explore/rate-limit.test.ts`,
  `explore/access.test.ts`, `explore/http-route.e2e.test.ts`,
  `trpc/router/explore.router.test.ts`.
- The report-render integration tests need AWS credentials; run them with
  `AWS_PROFILE=seaweedfs`.

## Remaining

- [ ] Set `EXPLORE_GUILD_ALLOWLIST` in the beta and prod 1Password items before
      the surface is usable in a deployed stage. Unset means nobody, so the page
      renders its unavailable state until an operator opts servers in.
- [ ] Watch `scout_explore_tokens_used_total` and the OpenAI budget counters
      after the first real users, and tighten the per-user quotas if a
      conversation costs more per turn than expected.
- [ ] Drive one real turn against a live model via `dev:web`. Everything below
      the model call is tested, but the prompt's grounding behaviour is
      unproven and streaming now depends on the model emitting `answer` first.
      This needs `op signin` and briefly disconnects the beta Discord bot, so
      it is a deliberate operator step rather than something to slip in.
