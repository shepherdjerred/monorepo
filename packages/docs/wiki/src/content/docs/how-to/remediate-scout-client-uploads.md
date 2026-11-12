---
title: Remediate Scout client uploads
description: Find who uploaded a match, then revoke their devices and remove or re-derive everything they supplied.
sidebar:
  order: 15
---

Every Scout desktop client upload records its device, and every device records
the signed-in Scout user who approved it. Use that record to find a
contributor and, if their data is bad, to undo it with one script.

Run the SQL against the Scout Postgres database
([connect first](/how-to/connect-to-a-homelab-database/)). Run the script
(`packages/scout-for-lol/packages/backend/scripts/repair/remediate-scout-client-uploads.ts`)
with the same database and object-store environment, plus `toolkit` for Temporal.

## Find a contributor

1. Look up the source of one match. The selection row names the observation,
   the observation names the device, and the device names its owner:

   ```sql
   SELECT cm."riotMatchId", o."observationId", d.id AS "deviceId",
          d."deviceName", d."deviceState", d."ownerId"
   FROM "ScoutClientCanonicalMatch" cm
   JOIN "ScoutClientObservation" o ON o."observationId" = cm."sourceObservationId"
   JOIN "ScoutClientDevice" d ON d.id = o."deviceId"
   WHERE cm."riotMatchId" = 'NA1_5653248720';
   ```

   No row means the stored match was not client-supplied.

2. List every observation any device sent for the same game, including ones
   that were not selected:

   ```sql
   SELECT o."observationId", o.kind, o.disposition, d.id AS "deviceId", d."ownerId"
   FROM "ScoutClientObservation" o
   JOIN "ScoutClientDevice" d ON d.id = o."deviceId"
   WHERE o.kind = 'post_game' AND o."gameId" = '5653248720'
     AND upper(o."platformId") = 'NA1';
   ```

3. To find client-supplied matches without a match id, query the report lake:
   `SELECT match_id FROM matches WHERE data_source = 'SCOUT_CLIENT'`.

The same lookup is the backend function `lookupMatchContributors` in
`packages/scout-for-lol/packages/backend/src/scout-client/remediation/contributor-lookup.ts`.

:::caution[Timelines do not record their observation]
An archived timeline carries no observation id. The second query lists the
candidates a client timeline came from, not the one chosen.
:::

## Dry run

From `packages/scout-for-lol/packages/backend`, pass either scope. Without
`--apply` the script changes nothing:

```bash
bun run scripts/repair/remediate-scout-client-uploads.ts --owner <userId>
bun run scripts/repair/remediate-scout-client-uploads.ts --device <deviceId>
```

The plan lists the devices to revoke, then each match as one of:

| Action              | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| `rederive`          | Riot returns the match; its payload replaces the client's |
| `delete`            | Riot does not; the client-derived artifacts are removed   |
| `timeline`          | Riot's result stands; only a client timeline is replaced  |
| `observations-only` | Nothing client-derived was stored; raw evidence remains   |

A match is `rederive` or `delete` only when its selection row names one of the
scope's own uploads; another owner's selected match is never touched. The plan
also lists canonical prematch snapshots whose archived payload names one of the
scope's gameflow observations, and removes them before the observations.

It also counts prematch observations, raw observations, and identity aliases
learned from the devices. A match with `other device upload(s) exist` has
evidence from someone else too; decide whether deleting it is right.

## Apply

1. Rerun with `--apply`. It revokes the devices, then handles each match, then
   deletes the raw observations and learned aliases.
2. For a `rederive` match it fetches Riot's match and timeline first, so a Riot
   failure changes nothing. It then removes the client objects and receipts and
   ingests Riot's copy.
3. It rebuilds the report lake, then refreshes Hall of Fame and competitions by
   running their Scout Temporal workflows to completion through
   `toolkit temporal`.

If any step fails, fix the cause and rerun the same command. Every step is
idempotent, and the match selection row is removed last so an interrupted run
still sees the match as client-derived.

:::note[Notifications already sent stay sent]
The script removes stored evidence. It does not retract Discord posts or
settled effects that already used it.
:::

## Verify

1. Rerun the dry run. The plan shows no active devices, no matches, and zero
   observations and aliases.
2. Rerun the lookup queries. Both return no rows for the owner's devices.
3. Query the lake for the match. A `rederive` match shows
   `data_source = 'RIOT'`; a `delete` match is absent.
4. Confirm the devices read `REVOKED` in `ScoutClientDevice`.

## Related

- [Pause or debug a schedule](/how-to/pause-or-debug-a-schedule/)
