# Scout Arena Pre-match — Privacy-scrubbed Tracked Players Are Dropped

**Date:** 2026-06-07
**Status:** Accepted — data loss is inherent to Riot's Spectator-V5 API; no fix possible. Document and move on.

## Summary

In Arena (and any queue), the **post-match** image shows all tracked players, but the
**pre-match** loading-screen image can be **missing one or more** of them. This is caused by
Riot's Spectator-V5 API scrubbing privacy-enabled participants: it nulls their `puuid` and
replaces their `riotId` with the champion's name, leaving no usable identity to match a
tracked player against. There is no way to recover the player's real card pre-match, so we
accept that scrubbed tracked players are absent from the pre-match image.

## Report that prompted this

A user's Arena game showed all 6 tracked players post-match (Team Krug: sjerred, ZynZhao,
DarkinBunnygirl; Team Minion: Snipzar, Windcatcher, **randompants1234**/Aatrox) but the
pre-match image showed only 5 — `randompants1234` was missing.

## Root cause (upstream — not a bug in our code)

Riot **Spectator-V5** scrubs participants who have privacy enabled. Confirmed from a real
captured payload (`packages/scout-for-lol/packages/backend/src/league/tasks/prematch/__tests__/testdata/spectator-ranked-flex.json`),
where 9 of 10 participants are normal and exactly one is scrubbed:

| Field          | Normal participant | Scrubbed participant                    |
| -------------- | ------------------ | --------------------------------------- |
| `puuid`        | `AlYREV57…` (real) | `null`                                  |
| `riotId`       | `sjerred#sjerr`    | `"Nami"` (champion name, no `#tagLine`) |
| `summonerName` | absent (V5)        | absent (V5)                             |
| `summonerId`   | absent (V5)        | absent (V5)                             |
| `championId`   | 19                 | 267 (= Nami)                            |

So a scrubbed card has **no stable identifier**: no puuid, no summonerId, no summonerName,
and a `riotId` that is just the champion's display name.

The pre-match path can only match participants to tracked players by puuid:

- `backend/.../prematch/active-game-detection.ts` — `participant.puuid === p.league.leagueAccount.puuid`
- `backend/.../prematch/loading-screen-builder.ts` — `isTrackedPlayer = puuid !== null && trackedPuuids.has(puuid)`
- `report/.../loading-screen/arena-layout.tsx` — renders only `isTrackedPlayer` participants

A scrubbed tracked player therefore can't be matched and is dropped from the image.

## Why post-match works

Post-match uses **Match-V5**, whose `metadata.participants` is always a complete list of real
puuids. Tracked players are matched there reliably, so they always appear post-match.

## Why there is no fix

To render a scrubbed player's card we would need to know _which_ of the (up to 18) cards is
theirs. The payload gives us nothing to pair on, and even by elimination we'd still lack their
real name and rank. The data simply isn't present in what Riot returns.

## What we accept

- Privacy-scrubbed tracked players are **absent from the pre-match image**. They still appear
  post-match. We accept this data loss.

## Mitigations deliberately declined

These were considered and intentionally **not** implemented (cost/benefit not worth it):

- **Correct the notification text** via per-puuid `getActiveGame` (the by-puuid lookup
  returns the game even for a scrubbed player, so we _could_ list them by alias in the text).
- **Draw a generic "hidden player" placeholder card** (alias known from detection, but no
  champion/rank). Pairing alias→card is impossible, so it would only ever be a non-specific
  placeholder.

If the limitation becomes more visible/annoying in practice, the notification-text mitigation
is the cheapest follow-up to revisit.

## Code references (comments point back here)

- `packages/scout-for-lol/packages/data/src/league/raw-current-game-info.schema.ts` — `puuid` / `riotId` field comments
- `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/loading-screen-builder.ts` — `isTrackedPlayer`
- `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/active-game-detection.ts` — tracked-player filter
