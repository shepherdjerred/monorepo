---
id: log-scout-league-classic-queue-errors-2026-07-29
type: log
status: complete
board: false
---

# Scout League Classic Queue Errors

Read-only investigation of the new Scout for LoL Bugsink issues beginning on
2026-07-29.

## Finding

The reported payload is valid League Classic traffic, not malformed Riot data.
Riot launched League Classic on 2026-07-29, while Scout release `6673` does not
recognize its queue, mode, map, or Classic-specific champion identifiers.

- Bugsink issue `bd55b3fd-d98f-4164-961a-333c93b77e2b` records production game
  `7933730085` as queue `4310`, map `453`, mode `JADE`, type `MATCHED`.
- The current League client catalog identifies queue `4310` as `Classic 5v5`
  in mode group `kJade`, and map `453` as `Classic Rift`.
- Riot's [League Classic announcement](https://www.leagueoflegends.com/en-us/news/dev/dev-league-of-legends-classic/)
  describes the mode as a 5v5 recreation of early Summoner's Rift. The static
  Riot developer queue and map constants do not yet include these IDs; the
  current client [queue catalog](https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/queues.json)
  and [map catalog](https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/maps.json)
  do.

At the initial snapshot, Bugsink had four separate queue-4310 issue groups
between 18:17 and 18:46 UTC. By the final snapshot at 18:57 UTC, a fifth
queue-4310 group had appeared. A sibling issue also appeared for queue `2450`,
mode `KIWI_JADE`, which the current client catalog calls
`ARAM: Mayhem Classic-ish`.

## Root Cause

`packages/scout-for-lol/packages/data/src/model/state.ts` returns `undefined`
for queue `4310` and mode `JADE`. The prematch loading-screen builder then
throws before layout, map, or participant rendering.

Adding only queue `4310` to the existing switch would expose two more failures:

1. `mapIdToName` does not recognize map `453`, and `determineLayout` does not
   recognize `JADE` or map `453`.
2. Classic Spectator payloads use a separate champion namespace. The inspected
   game contained ten champion IDs in the `600xx` range and four bans in that
   range. Riot's current `jade-champions.json` catalog maps those identifiers
   back to ordinary champion IDs; Scout's Data Dragon cache has no champions
   keyed by the `600xx` IDs.

Classic also reports Classic-specific summoner spell IDs such as `73`-`77` and
`711`-`714`. Scout's current summoner spell catalog does not resolve those
icons, although the renderer already omits unknown spell icons instead of
throwing.

## Impact

- The authoritative spectator JSON is saved to S3 and the report-store live
  ingest succeeds.
- Unfiltered subscriptions still receive the fallback Discord embed. Production
  logs confirm the notification for game `7933730085` was sent successfully.
- The rich prematch loading-screen image is not generated.
- The fallback embed displays the raw mode name `JADE` and cannot resolve the
  `600xx` champion ID to a useful champion name.
- Queue-filtered subscriptions reject an unknown queue by design, so they
  receive no Classic notification until Classic is represented in the queue
  model and can be selected in filters.
- The exception message contains the game ID, so Bugsink creates a separate
  issue group for each affected game.

## Recommended Remediation

Implement League Classic as a first-class queue type rather than aliasing it to
ordinary draft:

1. Add `classic` queue classification keyed durably by `gameMode === "JADE"`,
   with the known queue IDs covered by tests. Map queue `2450` /
   `KIWI_JADE` deliberately as its own supported behavior, most likely the
   existing `aram mayhem` type after confirming desired product labeling.
2. Add map `453` (`Classic Rift`) and classify the Classic layout as standard
   5v5.
3. Add a validated, committed Classic-champion ID mapping sourced from the
   client catalog, then normalize champion and ban IDs before Data Dragon image
   and display-name lookup.
4. Decide whether to add Classic summoner spell assets or explicitly render
   Classic without spell icons; test the chosen behavior.
5. Add regression fixtures from the stored Spectator payload and cover queue
   filtering, fallback text, rich-image generation, and report-lake
   normalization.
6. Give unknown-queue exceptions a stable Bugsink fingerprint keyed by queue,
   mode, and map so a future Riot queue does not create one issue per game.

## Session Log — 2026-07-29

### Done

- Correlated the named Bugsink issue and four initial sibling events with Scout
  release `6673` and the current source path.
- Confirmed queue `4310`, mode `JADE`, and map `453` are League Classic using
  Riot's announcement and current League client catalogs.
- Inspected the stored production Spectator payload without exposing player
  identities and confirmed the Classic-specific champion and spell ID shapes.
- Verified S3/report-store ingest and fallback Discord delivery succeeded for
  game `7933730085`.
- Identified the sibling queue `2450` / `KIWI_JADE` issue and the complete fix
  boundary beyond the initial queue switch.

### Remaining

- Implement, test, publish, deploy, and verify the League Classic support
  described above if authorized.
- Resolve the Bugsink issue groups only after the fix is deployed and fresh
  League Classic games produce the expected notification behavior.

### Caveats

- This session was diagnostic-only; no Scout source, deployment, or Bugsink
  issue state was changed.
- CommunityDragon mirrors current League client data and is ahead of Riot's
  static developer constants, but it is not a Riot-operated API.
- Postmatch behavior could not yet be verified because the observed Classic
  games had not completed during the investigation.
