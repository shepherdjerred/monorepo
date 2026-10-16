---
title: Recover rejected media downloads
description: Diagnose a rejected Sonarr or Radarr torrent and restore automatic replacement without bypassing file protection.
---

Use this procedure when a TV episode or movie remains missing after a dangerous torrent was rejected.

## 1. Inspect the safety scan

Open the [`media-download-safety` Schedule](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/temporal/src/schedules/media-safety.ts) in Temporal's `prod` namespace.
Inspect the latest [`runMediaDownloadSafety` execution and its home-worker Activity](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/temporal/src/workflows/ha/media-safety.ts).
The [guard result](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/temporal/src/lib/media-safety/guard.ts) lists candidate torrent hashes, dangerous filenames, and removal counts for Sonarr and Radarr.

If `enforce` is false, inspect the [`media-download-safety-enabled` declaration](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/feature-flags/src/managed-flag-inventory.json) in the Temporal feature-flag namespace.
Its [configuration resolver](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/temporal/src/config/media-safety.ts) controls enforcement for each scan.
Keep observation mode while investigating an unexpected candidate. Enable enforcement only after reviewing its exact ownership and paths.

If the latest scan failed, inspect the Activity error before retrying it.
For [authentication failures](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/temporal/src/lib/media-safety/client.ts), repair the configured credentials.
For [missing history or blocklist evidence](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/temporal/src/lib/media-safety/arr.ts), inspect that application's records.

## 2. Check the application's replacement search

In Sonarr or Radarr, open the episode or movie's History and Blocklist.
Confirm the rejected torrent has the [required failed-download event and blocklist entry](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/temporal/src/lib/media-safety/arr.ts).
Inspect Activity for a replacement download.

If no replacement is available, run an interactive search and inspect its rejection reasons.
Choose another release that meets the existing quality profile. Leave the known dangerous release blocklisted.

For a stopped torrent, compare its hash with the application's grabbed history.
The [guard's ownership checks](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/temporal/src/lib/media-safety/guard.ts) and [path validation](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/temporal/src/lib/media-safety/contracts.ts) prevent removal without sufficient evidence.
Resolve the missing evidence before removing files; never substitute a similarly named release.

## 3. Verify protection and import

Check that every Sonarr and Radarr indexer enables both **Executables** and **Potentially Dangerous** under **Fail Downloads**.
The next scan's [indexer reconciliation](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/temporal/src/lib/media-safety/arr.ts) restores those fields when Prowlarr creates an indexer.

In qBittorrent, verify that **Excluded file names** is enabled.
Change the [shared media policy](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/homelab/src/media-download-policy.json) through the [homelab release procedure](/how-to/cut-a-homelab-release/).
The [qBittorrent chart](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/homelab/src/cdk8s/src/resources/torrents/qbittorrent.ts) validates managed settings at startup.

Confirm the replacement imports into Sonarr or Radarr and then appears in Plex.
A completed download or successful safety scan alone does not establish that the item is watchable.

To reproduce filename filtering locally, run the [native canary script](https://github.com/shepherdjerred/monorepo/blob/bb384d5d2701966c98b6def3ea05ba9dd513e8b4/packages/homelab/src/cdk8s/scripts/media/test-download-safety.ts) from the repository root with Docker available:

```bash
bun run --cwd packages/homelab/src/cdk8s test:media-safety
```

The check creates disposable local peers and harmless text fixtures, verifies ordinary torrent files and magnet links, and removes its containers afterward.

## Related

- [Roll out a Temporal Worker Deployment](/how-to/roll-out-a-temporal-worker-deployment/)
- [Check the Flipt flag inventory](/how-to/check-flipt-flag-inventory/)
