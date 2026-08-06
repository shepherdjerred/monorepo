---
id: reference-completed-2026-05-11-scout-season-dropdown-hardening
type: reference
status: complete
board: false
---

# Scout for LoL — `/competition` season dropdown hardening

## Context

User reported that the `season` option on `/competition create` accepts a free-text string rather than rendering as a Discord select list.

The option is declared correctly as a choice dropdown in
`packages/scout-for-lol/packages/backend/src/discord/commands/competition/index.ts`:

```ts
.addStringOption((option) =>
  option
    .setName("season")
    .setDescription("Season (alternative to fixed dates)")
    .setRequired(false)
    .addChoices(...getSeasonChoices()),
)
```

…but `getSeasonChoices()` filters by `season.endDate >= now`, and every season hardcoded in
`SEASONS` had ended as of 2026-05-11:

| Season ID             | Display Name        | End Date   | Status         |
| --------------------- | ------------------- | ---------- | -------------- |
| `2025_SEASON_3_ACT_1` | Trials of Twilight  | 2025-10-21 | ended 202d ago |
| `2025_SEASON_3_ACT_2` | Worlds 2025         | 2026-01-07 | ended 124d ago |
| `2026_SEASON_1_ACT_1` | For Demacia (Act 1) | 2026-03-04 | ended 68d ago  |
| `2026_SEASON_1_ACT_2` | For Demacia (Act 2) | 2026-04-30 | ended 11d ago  |

`.addChoices(...[])` is a no-op, so Discord renders the option as a plain text input.
Same issue affected `/competition edit` (same file, ~line 205).

## Scope

Hardening only. Do **not** refresh `SEASONS` data in this change — the user will update the season
data separately. This change makes the failure mode loud the next time the season list goes stale.

## Changes

| File                                                                                | Change                                                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/scout-for-lol/packages/backend/src/discord/commands/competition/index.ts` | Compute `seasonChoices` once at module load; throw if empty; reuse it. |
| `packages/scout-for-lol/packages/data/src/seasons.test.ts`                          | Added `getSeasonChoices().length > 0` invariant test.                  |

The throw is in `index.ts` (not `seasons.ts`) so non-bot consumers of `seasons.ts` (tests, the
report package, etc.) keep working when no active seasons exist; only the Discord registration
path fails fast.

## Verification

1. `cd packages/scout-for-lol/packages/backend && bun run typecheck`
2. `cd packages/scout-for-lol/packages/data && bun test src/seasons.test.ts` — expected to **fail
   today** (no active seasons), confirming the new invariant bites.
3. After `SEASONS` is refreshed: re-run #2, start the bot, and confirm `/competition create` and
   `/competition edit` show a season dropdown.

## Follow-up

- Refresh `SEASONS` in `packages/scout-for-lol/packages/data/src/seasons.ts` with the current
  LoL act (manually maintained — Riot has no reliable season API). Until that lands, both the new
  unit test and the bot startup will fail loudly.
