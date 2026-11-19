---
title: Erase a crawled player
description: Process a deletion request for a player Scout's participant crawl stored, and verify that every copy is gone.
sidebar:
  order: 16
---

The participant crawl stores matches of players Scout does not track. When one
of them asks to be erased, one script records the request and Scout's lake
maintenance removes the rest. Run the script
(`packages/scout-for-lol/packages/backend/scripts/repair/erase-crawled-player.ts`)
from `packages/scout-for-lol/packages/backend` with the production database
environment ([connect first](/how-to/connect-to-a-homelab-database/)).

This covers crawl data only. A player Scout's servers track keeps their
tracked matches; that corpus has no erasure path yet.

## Record the request

1. Dry run with the PUUID, or with the Riot ID and its region. Pass the Riot ID
   whenever you know it, even with `--puuid`: stored Explore answers that name
   the player only as `Name#TAG` are found by it. A Riot ID lookup needs
   `RIOT_API_KEY`.

   ```bash
   bun run scripts/repair/erase-crawled-player.ts --puuid <PUUID> --riot-id 'Name#TAG'
   bun run scripts/repair/erase-crawled-player.ts --riot-id 'Name#TAG' --region EU_WEST
   ```

   The output names the PUUID's SHA-256, whether the crawl's frontier holds
   the player, and how many Explore copies name them.

2. Rerun with `--apply`. In one transaction it records the hash in
   `ErasedPuuid` and deletes the player's `CrawlFrontier` row. It then redacts
   the Explore copies in place:

   | Copy                                     | Redaction                                   |
   | ---------------------------------------- | ------------------------------------------- |
   | `ExploreToolPayload`                     | Payload replaced by a `redacted` notice     |
   | Assistant `ExploreMessage` (share links) | Text replaced; preview, cards, trace nulled |
   | `ScoutInteractiveRun` progress           | Preview, trace, activity, partial nulled    |

From this moment every global-scope read of crawl data hides each crawled
match that names the player: the hash is a query-time tombstone until the lake
files are rewritten. The crawl never admits, visits or stores them again.

## Let the rewrite run

The `report-lake-fold` Schedule (every 15 minutes) and the nightly
`report-lake-rebuild` do the rest inside each new build, then publish it:

1. Sweep raw `crawl/v1/` segments, resuming from the saved cursor, and rewrite
   each one without the player's matches. A fold checks 500 segments, a
   rebuild 10,000. The original object is deleted after its replacement is
   committed.
2. Rewrite every `*_crawl` lake file that holds one of the player's matches.
3. After the build publishes, set `lakeErasedAt`, which ends the tombstone.

To start a fold now instead of waiting, run the workflow the Schedule runs:

```bash
toolkit temporal --namespace prod workflow execute \
  --type scoutReportLakeWorkflow --task-queue scout-prod \
  --workflow-id scout-prod-report-lake-erasure-$(date +%Y%m%d%H%M%S) \
  --input '{"stage":"prod","kind":"fold"}'
```

Every step is idempotent. If a run fails, fix the cause; the next run resumes
where the last one stopped.

## Verify

1. Rerun the dry run. It reports `Complete: yes` once the raw sweep and the lake
   erasure are both recorded and no crawl object is queued for deletion, and it
   reports zero Explore copies.
2. Check the progress row directly:

   ```sql
   SELECT "erasedAt", "rawSweptAt", "lakeErasedAt", "segmentsRewritten",
          "matchesRemoved", "copiesRedacted",
          (SELECT count(*) FROM "CrawlObjectDeletion") AS "queuedDeletions"
   FROM "ErasedPuuid" WHERE "puuidHash" = '<hash from the dry run>';
   ```

3. Confirm no crawl row names the player. Neither query may return anything:

   ```sql
   SELECT 1 FROM "CrawlFrontier" WHERE puuid = '<PUUID>';
   SELECT 1 FROM "CrawlMatch" WHERE "visitedPuuid" = '<PUUID>';
   ```

4. Ask Explore a global question about the player's Riot ID. It finds no
   crawled games.

:::caution[Copies outside the live system]
Erasure does not reach backups. Each store keeps the player until its own
retention expires:

- Raw segments (`crawl/v1` in the `scout-<stage>` SeaweedFS bucket):
  `filer.backup` mirrors the delete to the Backblaze `seaweedfs-backups`
  bucket, which keeps the previous version for 30 days.
- Report lake (the `scout-storage-claim` volume) and PostgreSQL (the
  `pgdata-scout-<stage>-postgresql-0` volume): Velero snapshots both volumes
  every 6 hours (kept 3 days), daily (7 days), weekly (30 days) and monthly
  (90 days). The player stays in the monthly snapshot for up to 90 days. The
  Backblaze `sjerred-velero` bucket then keeps hidden versions a further 30
  days.
- PostgreSQL has no WAL archive: the `archive_command` is `/bin/true`, so the
  snapshots above are its only backup.

The lake keeps
the build before the current one on disk until the next build publishes,
normally the next fold. Nothing reads it once a newer build is current.
:::

## Related

- [Remediate Scout client uploads](/how-to/remediate-scout-client-uploads/)
- [Pause or debug a schedule](/how-to/pause-or-debug-a-schedule/)
