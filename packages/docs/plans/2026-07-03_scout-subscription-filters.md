---
id: plan-2026-07-03-scout-subscription-filters
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Scout — Extensible Per-Subscription Notification Filters (queues first)

## Context

Scout subscriptions were all-or-nothing: a subscription notified a Discord channel about
**every** match for a player. This adds **filters** so notifications can be scoped by queue
type (e.g. ranked only), with an **extensible** model that grows to future dimensions
(champion, role, win/loss) without a schema change. All notification types (post-game report,
pre-game/loading-screen) respect filters. Filters are settable at creation and editable
afterward on both the Discord and web surfaces; the web additionally supports a **bulk**
"set all subscriptions in a channel" edit.

**Decisions (confirmed with the user):**

- Discord multi-queue input = comma-separated string option + autocomplete (scales to future
  high-cardinality dimensions like champions; no 25-option select-menu ceiling).
- Bulk edit = web UI only.
- No named presets — individual queue types only ("ranked" = pick `solo, flex`).

## What shipped

### Data model (`packages/data`)

- `data/src/model/subscription-filter.ts` (new):
  - `SubscriptionFilterSpec = { version: 1, filters: SubscriptionFilter[] }`;
    `SubscriptionFilter` = `z.discriminatedUnion("type", [QueueFilterSchema])`, keyed by
    `type` so new dimensions are one union member. `superRefine` rejects duplicate types;
    `queues` is `.min(1)` (absence of a filter, not an empty list, means notify-all).
  - **Branded** `SerializedSubscriptionFiltersSchema = z.string().brand<"SerializedSubscriptionFilters">()`
    (matches `DiscordChannelId`/`LeaguePuuid` house style). `serializeSubscriptionFilters(spec)`
    is the ONLY producer — a bare string can't reach the DB column; its branded output is still
    assignable to the plain `string` Prisma wants.
  - `filtersPass(spec, ctx)` — pure, AND across filter types, null/empty ⇒ notify-all,
    unknown queue ⇒ fail-closed for queue filters. `parseSubscriptionFilters(raw)` — fail-open
    (bad blob ⇒ null ⇒ notify-all, never a silent mute). `subscriptionFilterQueues` /
    `describeSubscriptionFilters` shared helpers (used by backend + app).

### Persistence

- `Subscription.filters String?` column + migration `20260703000000_add_subscription_filters`
  (`ALTER TABLE "Subscription" ADD COLUMN "filters" TEXT`). Nullable, no backfill ⇒ existing
  rows = notify-all. `template.db` test fixture regenerated.

### Shared CRUD (`lib/subscription/`)

- `types.ts`: `AddSubscriptionInput.filters`, `SetSubscriptionFiltersInput` /
  `SetChannelFiltersInput` + result unions, `SubscriptionListItem.filters`.
- `add.ts`: serialize on create via `serializeSubscriptionFilters`.
- `filters.ts` (new): `setSubscriptionFilters` (one sub) + `setChannelFilters` (bulk
  `updateMany` over a channel).
- `list.ts`: parse `filters` into each list item.

### Dispatch (the granularity fix)

- `database/index.ts` `getChannelsSubscribedToPlayers` now returns `SubscribedChannel[]` —
  per channel, the in-match subscriptions with parsed filters (deduped by subscription id).
- `league/tasks/notification-filters.ts` (new): `channelsPassingQueueFilter` (deliver to a
  channel iff ≥1 in-match sub passes) + `deliverToChannels` (shared per-channel send loop with
  permission/Sentry handling, used by both dispatchers).
- Post-game `match-history-polling.ts` `processMatch` and pre-game `prematch-notification.ts`
  `sendPrematchNotification` compute `queueType` and filter to `deliverChannels` before
  rendering/sending.

### Discord (`discord/commands/subscription/`)

- `index.ts`: `queues` autocomplete option on `add`; new `edit-filters` subcommand.
- `queue-filter-arg.ts` (new): `parseQueuesArg` (comma list → spec, friendly invalid-token
  handling), `suggestQueueCompletions` (appends the next queue to the typed list).
- `add.ts`: parse `queues`, thread `filters`, reflect chosen queues in the reply.
- `edit-filters.ts` (new): `executeSubscriptionEditFilters` (empty `queues` clears).
- `commands/index.ts`: dispatch `edit-filters` + `queues` autocomplete branch.

### Web (`packages/app`) + tRPC

- `subscription.router.ts`: `add.filters`; new `setFilters` + `setChannelFilters` mutations
  (+ audit rows). `audit/index.ts`: `SUBSCRIPTION_SET_FILTERS` / `SUBSCRIPTION_BULK_SET_FILTERS`.
- `subscription-filter-fields.tsx` (new): queue multi-select popover (empty = all queues).
- `subscription-filter-dialog.tsx` (new): handles single edit + channel bulk.
- `use-add-subscription.ts` / `subscription-fields.tsx`: filters in the add form.
- `guild-subscriptions.tsx`: "Filters" column, "Edit filters" row action, "Set filters for a
  channel" bulk control.

## Verification

- `bun run typecheck` — all scout packages ✓
- `bun test` — data 426 pass, backend 1017 pass, 0 fail ✓ (new: `subscription-filter.test.ts`,
  `queue-filter-arg.test.ts`, filter cases in `subscriptions.integration.test.ts` incl. the
  multi-sub/single-channel `some(filtersPass)` case; updated prematch mock shape)
- `bunx eslint` on all changed files ✓; `bun run knip` clean; `bun run build` (app) ✓

### Offline web-test path (added this session)

There is no runtime auth bypass. To test the tRPC/web surface without Discord OAuth or a real
Discord backing, added `src/testing/test-trpc-caller.ts` — `createOfflineTrpcHarness(name)`
stubs the Discord guild guard + points the router's Prisma singleton at an isolated migrated
DB and returns authenticated/anonymous `appRouter.createCaller` instances. First tRPC router
test in the repo: `src/trpc/router/subscription-filters.router.test.ts` (covers `setFilters`,
`setChannelFilters`, and unauthenticated rejection). Documented under **Testing Strategy** in
`packages/scout-for-lol/AGENTS.md`.

## Known trade-offs (carry into PR description)

- **Unknown/new Riot queue IDs fail closed** for _filtered_ subs (dropped until `parseQueueType`
  learns them); unfiltered subs unaffected. Intentional.
- **Match-level message vs per-sub filter**: a channel with mixed subs gets the full
  multi-player message if any in-match sub passes — consistent with today's
  one-message-per-match-per-channel model.

## Live test (2026-07-03, via `dev:web`)

Booted the full stack once (backend :3000 + Vite :5180) against `local-web-dev.db`, then shut
down to reconnect the beta bot. Verified:

- Migration `20260703000000_add_subscription_filters` applied to a real DB via
  `prisma migrate deploy`; `sqlite3 .schema Subscription` shows `"filters" TEXT`.
- Backend booted with all new code — bot ready (Scout beta#9846), cron tasks green, **zero
  runtime errors**.
- **Discord command shape confirmed against the live Discord API** (`GET /applications/{id}/commands`):
  `subscription` subcommands include `edit-filters`; `add` and `edit-filters` both expose a
  `queues` option with `autocomplete: true`.
- SPA serves HTTP 200 at `/app/`.

Not covered by the live test: the authenticated web UI visuals (Filters column, queue
multi-select, bulk control) sit behind Discord OAuth login — capture screenshots by logging in
at `http://localhost:5180/app/` while `bun run dev:web` runs.

## UI screenshots (offline render)

Captured the four web-UI states by rendering the real components with the app's real Tailwind
tokens in a throwaway Vite entry (mock data, dummy tRPC client — screenshots never fire
mutations), since the live page sits behind Discord OAuth + `assertGuildAdmin`. Attached to the
PR: (1) subscriptions table with the new "Filters" column + bulk button, (2) queue multi-select
open, (3) edit-filters dialog, (4) "set filters for a channel" bulk dialog. Throwaway
`demo.html` / `demo-main.tsx` were removed after capture.

## Remaining

- [ ] Merge PR from `feature/subscription-filters`.

## Session Log — 2026-07-03

### Done

- Full feature implemented on branch `feature/subscription-filters` (worktree
  `.claude/worktrees/sub-filters`): data model + branded serialized type, Prisma migration,
  shared CRUD, both dispatch paths, Discord `add`/`edit-filters` + autocomplete, tRPC + web UI
  (add/edit/bulk). Files listed above.
- All typecheck/test/lint/knip/build gates green; live `dev:web` boot verified migration +
  Discord command shape; offline tRPC harness + UI screenshots captured for the PR.

### Remaining

- Merge the PR.

### Caveats

- `template.db` fixture changed (regenerated for the new migration) — intended, commit it.
- Two documented behavioral trade-offs above (fail-closed unknown queues; match-level message).
