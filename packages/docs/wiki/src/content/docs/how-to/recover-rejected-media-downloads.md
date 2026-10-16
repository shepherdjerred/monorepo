---
title: Recover rejected media downloads
description: Diagnose a rejected Sonarr or Radarr torrent and restore automatic replacement without bypassing file protection.
---

Use this procedure when a TV episode or movie remains missing after a dangerous torrent was rejected.

## 1. Inspect the safety scan

Open the `media-download-safety` Schedule in Temporal's `prod` namespace.
Inspect the latest `runMediaDownloadSafety` result and its home-worker Activity.
The result lists candidate torrent hashes, dangerous filenames, and removal counts for Sonarr and Radarr.

If `enforce` is false, inspect `media-download-safety-enabled` in the Temporal feature-flag namespace.
Keep observation mode while investigating an unexpected candidate. Enable enforcement only after reviewing its exact ownership and paths.

If the latest scan failed, inspect the Activity error before retrying it.
Authentication failures require repairing the configured credentials. Missing history or blocklist evidence requires inspecting that application's records.

## 2. Check the application's replacement search

In Sonarr or Radarr, open the episode or movie's History and Blocklist.
Confirm the rejected torrent has a failed-download event and a corresponding blocklist entry.
Inspect Activity for a replacement download.

If no replacement is available, run an interactive search and inspect its rejection reasons.
Choose another release that meets the existing quality profile. Leave the known dangerous release blocklisted.

For a stopped torrent, compare its hash with the application's grabbed history.
The guard leaves data untouched when ownership or removal safety cannot be established.
Resolve the missing evidence before removing files; never substitute a similarly named release.

## 3. Verify protection and import

Check that every Sonarr and Radarr indexer enables both **Executables** and **Potentially Dangerous** under **Fail Downloads**.
The next safety scan restores those fields when Prowlarr creates an indexer.

In qBittorrent, verify that **Excluded file names** is enabled.
Change its policy through the repository's media configuration and release path; startup validates managed settings against the declaration.

Confirm the replacement imports into Sonarr or Radarr and then appears in Plex.
A completed download or successful safety scan alone does not establish that the item is watchable.

To reproduce filename filtering locally, run this from the repository root with Docker available:

```bash
bun run --cwd packages/homelab/src/cdk8s test:media-safety
```

The check creates disposable local peers and harmless text fixtures, verifies ordinary torrent files and magnet links, and removes its containers afterward.
