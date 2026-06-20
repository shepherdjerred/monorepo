# Scout-for-LoL Web App (`app/`) — UX & Management Improvements

## Status

Complete (pending PR review + manual e2e)

## Context

The Scout-for-LoL **web app** (`packages/scout-for-lol/packages/app/`, a Vite + React + React-Router-v7 SPA — the authenticated dashboard, not the Astro marketing `frontend/`) showed raw IDs and had limited management affordances. This change makes the dashboard show human-readable names, adds pagination, allows richer in-context editing, and adds typeahead search + a support link. Shipped as one PR.

### Owner decisions

- **Support link** → Discord support server invite `https://discord.gg/qmRewyHXFE`.
- **Riot game name** → fetch-on-demand + 24h DB cache (new nullable columns).
- **Editing scope** → full-scope (inline actions + new `updateAccount` mutation).
- **Delivery** → one PR.

## Feature Overview

| #   | Feature                                             | Backend                                                           | Frontend                                 |
| --- | --------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| 1   | Guild **name** in workspace header                  | reuse `guild.listManageable`                                      | `routes/guild-workspace.tsx`             |
| 2   | Discord **names** (not IDs)                         | `discord.resolveUsers` + serializer enrichment                    | `<DiscordUser>` + `useDiscordNames`      |
| 3   | **Riot ID** (`gameName#tagLine`)                    | `Account.riotGameName/riotTagLine/riotIdUpdatedAt` + 24h refresh  | account table column                     |
| 4   | **Pagination** (subs, competitions, audit, players) | cursor pagination                                                 | `<LoadMore>` + `useInfiniteQuery`        |
| 5   | Theme picker → **navbar**                           | —                                                                 | `app.tsx` + `routes/require-session.tsx` |
| 6   | **Full-scope editing**                              | new `player.updateAccount` mutation                               | inline dialogs on player detail          |
| 7   | **Fuzzy search** (Riot ID + Discord)                | `riot.resolveRiotId/searchKnownAccounts`, `discord.searchMembers` | combobox primitives + wrappers           |
| 8   | **Support link**                                    | —                                                                 | navbar link → Discord invite             |

## Key implementation notes

- **Riot ID cache** — `src/lib/riot/account-riot-id.ts`: `getRiotIdByPuuid` (twisted `Account.getByPUUID`) + `refreshAccountRiotIds` (await-on-null, fire-and-forget background refresh for stale-but-present; 24h TTL). Seeded on add (account-mutations + subscription add). Migration `20260619000000_add_account_riot_id`.
- **Discord names** — `src/lib/discord/resolve-users.ts` (5-min in-memory TTL, fail-soft to raw id). Player detail/summary + subscription list enriched server-side; audit page uses the `useDiscordNames` batch hook.
- **Cursor pagination** — `{items, nextCursor}` on `subscription.list`, `competition.list` (new `getCompetitionsByServerPaginated`), `subscription.listAuditLog`. **Fixed a pre-existing off-by-one** in the `listPlayers` cursor pattern (it used the peeked overflow row's id as the cursor, which with `skip:1` dropped one row per page boundary; now uses the last returned row's id). Integration test added.
- **Combobox** — built on new `@radix-ui/react-popover`; generic `ui/combobox.tsx` + domain wrappers `riot-id-combobox`, `discord-member-combobox`, `player-alias-combobox`. Raw-snowflake paste still accepted in the Discord member combobox.
- **Inline editing** — dialogs `rename-player-dialog`, `link-discord-dialog`, `add-account-dialog`, `edit-account-dialog`; account row Edit/Delete; player-detail account table extracted to `player-detail-sections.tsx` to stay under the 500-line / 400-line-per-function caps.

## Verification done

- `bunx tsc --noEmit` clean in `app/` and `backend/`.
- `bunx eslint` clean across changed files (both packages).
- Backend `bun test`: 965 pass / 24 skip / 0 fail (incl. new pagination test).

## Session Log — 2026-06-19

### Done

- Backend (`packages/scout-for-lol/packages/backend/`): schema migration + Riot ID cache lib; `discord` router (`resolveUsers`, `searchMembers`); `riot` router (`resolveRiotId`, `searchKnownAccounts`); cursor pagination on subs/competitions/audit (+ off-by-one fix in `listPlayers`); `player.updateAccount` mutation + `ACCOUNT_UPDATE` audit action; serializer enrichment for Discord names + Riot IDs; pagination integration test.
- Frontend (`packages/scout-for-lol/packages/app/`): navbar with theme toggle + support link; guild name in header; `DiscordUser` + `useDiscordNames`; Riot ID column; `LoadMore` + infinite queries; combobox primitives + 3 domain wrappers swapped into add/invite/admin flows; inline rename/link-unlink/add-edit-delete-account dialogs on player detail.

### Remaining

- **Manual e2e** via `bun run --filter='./packages/scout-for-lol' dev:web` (needs `op signin`) — confirm each feature in the running app; capture PR before/after screenshots + a typeahead clip.
- **Verify `discord.searchMembers`** returns results with the current gateway intents (`Guilds|GuildVoiceStates|GuildModeration`). Query-based `members.fetch` should not need the privileged `GuildMembers` intent, but confirm in staging; if empty, escalate the intent decision to the owner. The combobox degrades gracefully (raw-ID paste still works).
- Open the PR and run the standard CI/review gates.

### Caveats

- **Riot read cost**: first load of a never-resolved account makes one Riot API call (await, capped at 10/req, fail-soft to alias); stale-but-present accounts refresh in the background. Backfill happens lazily on read — no separate backfill script was needed given the 24h cache.
- **Inline account Delete** is keyed by the cached Riot ID (`gameName#tagLine`); it's disabled until the Riot ID resolves and falls back to the Admin page for accounts with an unparseable region. Inline **Transfer** still lives on the `/admin` route (uses `transferAccount`); not surfaced on the detail page.
- `@radix-ui/react-popover@1.1.17` added to `packages/scout-for-lol/packages/app/package.json` (+ `bun.lock`); Renovate-tracked.
- `subscription.list` / `competition.list` return shape changed from array → `{items, nextCursor}`; the Discord `/subscription list` command and all web callers were updated in the same change.

## Round 2 — post-demo feedback (commit `ef197f948`)

After clicking through round 1, the owner asked for four refinements:

1. **Navbar dropdown** — left = brand "Scout" + "Guilds"; right = `@username` dropdown (`components/user-menu.tsx` on the Popover) holding the theme selector, "Report a bug", and "Sign out".
2. **Hide guild ID** — the workspace header shows only the guild name; the raw snowflake is never rendered.
3. **Three-source Riot ID search** — researched that the Riot API has **no** partial-name search (only exact `by-riot-id`); OP.GG autocompletes from its own crawled index. Implemented all three sources:
   - **Own index** — new `SummonerIndex` table (global cache; prefix `startsWith` on `gameName`). Populated by `recordRiotResolution` on every confirmed Riot lookup + a `backfillFromExisting` (Account + `PrematchParticipantFact.riotId`) one-off (`scripts/backfill-summoner-index.ts`). Self-heals: evicted on a genuine 404 (via `extractHttpStatus`), never on transient errors.
   - **OP.GG** — `src/lib/riot/opgg-search.ts` proxies OP.GG's **Next.js server action** (POST `/` with `next-action` id + RSC response), Zod-parsed, fail-soft to `[]`, TTL-cached. Verified live (`sjerred#sjerr` → Platinum 4).
   - **Riot** — existing `resolveRiotId` verifies/canonicalizes the picked Riot ID; the add flow re-verifies before storage.
   - `riot.searchSummoners` merges index (first) + OP.GG, de-duped. The combobox popover now only opens with results (no empty "no results" box). Removed the now-superseded `searchKnownAccounts`.
4. **Removed the Admin tab** — rename/merge/delete-player, link/unlink Discord, and add/edit/delete/**transfer** account are all inline on the player detail page now (new `merge-players-dialog.tsx`, `transfer-account-dialog.tsx`; `PlayerAccountsTable` gained `onTransfer`). Deleted `admin-tools.tsx`, `player-admin-forms.tsx`, `account-admin-forms.tsx`, `admin-form-controls.tsx` (`RiotAccountFields` inlined into `add-account-dialog.tsx`).

### Round 2 — Verification done

- `tsc` + `eslint` clean (app + backend); `knip` clean (no orphans from the admin deletions). Backend `bun test`: 973 pass / 0 fail (incl. new `opgg-search`/`parseRiotId` tests). `opggSearch` verified live. Dev server restarted with the new migration applied.

### Round 2 — Remaining

- **OP.GG action id is build-tied** — `OPGG_ACTION_ID`/`OPGG_ROUTER_STATE` in `opgg-search.ts` were captured 2026-06-19. When OP.GG redeploys these go stale and OP.GG suggestions silently stop (the field still works via our index + Riot resolve). Re-capture from op.gg devtools (Network → the POST to `/` with `next-action`) and update the constants.
- Run `scripts/backfill-summoner-index.ts` once in prod to seed the index from existing data.
- Optional: a periodic re-verify cron to evict renamed-but-never-requeried index entries.
- Manual e2e of the navbar dropdown, hidden guild id, 3-source typeahead, and the inline player ops; PR screenshots.

### Round 2 — Caveats

- **OP.GG dependency is unofficial + ToS-gray** (owner-approved). Contained to one module, fail-soft, never persisted unverified.
- `SummonerIndex` is global (cross-guild); the `searchSummoners` procedure that reads it is guild-admin gated.
