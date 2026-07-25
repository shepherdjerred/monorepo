---
id: log-2026-06-27-qbittorrent-seeding-and-exporter-user-fix
type: log
status: complete
board: false
---

# qBittorrent seeding verification + exporter username fix

## Context

Goal: make a **private tracker** seed to **3.0 ratio OR 7 days, whichever first**, then have
Sonarr/Radarr clean up — without breaking hit-and-run rules. Per-tracker seed rules are set on the
**Prowlarr** indexer (Seed Ratio / Seed Time), which propagate to Sonarr/Radarr → qBittorrent as
**per-torrent** share limits. The user had already set the Prowlarr criteria. This session verified
the rest of the chain against the live cluster (`admin@torvalds`, `media` ns).

## What we found — the loop was already correctly wired

| Piece                       | Controls                                                 | Live state                        | Verdict                 |
| --------------------------- | -------------------------------------------------------- | --------------------------------- | ----------------------- |
| Private 3.0 / 7d thresholds | Prowlarr indexer seed criteria → per-torrent qBit limits | set by user                       | ✅                      |
| qBit stop **action**        | global `max_ratio_act`                                   | `0` = Pause (not remove)          | ✅ — \*arr owns removal |
| Removal after seed+import   | Sonarr/Radarr `removeCompletedDownloads`                 | `true` (both, qBittorrent client) | ✅                      |
| Completed handling          | `enableCompletedDownloadHandling`                        | `true` (both)                     | ✅                      |

qBittorrent needed **no** threshold config — Prowlarr drives those per-torrent, and the global
stop action was already Pause. Categories: `tv-sonarr` (Sonarr), `radarr` (Radarr).

## Live qBittorrent global tweaks applied (runtime, not IaC)

Applied via the qBittorrent WebUI API (`setPreferences`) — these live in the `/config` PVC, not in
git, so they're recorded here for drift-recovery:

- `GlobalMaxSeedingMinutes`: 1440 → **10080** (public default bumped 1 day → 7 days).
- `GlobalMaxInactiveSeedingMinutes`: 1440 → **-1** (disabled). The inactive-seeding limit applied
  to private torrents too (Prowlarr doesn't set a per-torrent inactive limit), so an idle private
  torrent could stop before 3.0/7d → H&R risk. Disabling removes that; the 7d seeding-time limit
  still bounds disk.
- Unchanged: `GlobalMaxRatio=1`, `max_ratio_act=0` (Pause).

## Bug fixed in this PR — qBittorrent metrics were dead

The Prometheus exporter sidecar authenticated as **`admin`**, but the real WebUI username is
**`jerred`** (`WebUI\Username` in the `/config` PVC). Effects:

- Every scrape failed auth → **`qbittorrent_up = 0`** (monitoring saw qBittorrent as down though it
  was healthy; exporter logs: `Couldn't get server info: Unauthorized`).
- Repeated failed logins **banned the pod's localhost IP**, 401-ing all WebUI access from
  port-forwards (had to verify via a second pod's IP).

Fix: `QBITTORRENT_USER` `admin` → `jerred` in
`packages/homelab/src/cdk8s/src/resources/torrents/qbittorrent.ts`. Confirmed the 1Password
`password` field is `jerred`'s (login succeeded from a non-banned pod IP), so the username was the
only wrong field. After deploy, the ban clears once it expires (~1h after the last failed login).

## Session Log — 2026-06-27

### Done

- Verified the full private-tracker seeding→removal loop is already correctly configured (table above).
- Applied 2 live qBit global tweaks: seeding time 1d→7d; inactive-seeding limit disabled. Confirmed
  persisted to `qBittorrent.conf`.
- Fixed exporter username `admin`→`jerred` in `qbittorrent.ts` (this PR).

### Remaining

- Deploy this PR (ArgoCD) and confirm `qbittorrent_up` flips to 1 and exporter logs stop erroring.

### Caveats

- The live qBit global tweaks are runtime `/config` PVC state, **not** IaC — a PVC wipe loses them
  (and the `WebUI\Username`, seed limits, VPN interface binding). Re-apply from this log if needed.
- Existing private-tracker torrents already seeding keep their prior limits; only new grabs get the
  Prowlarr 3.0/7d criteria.
- Imports **copy, not hardlink** (`/downloads` = `qbittorrent-hdd-pvc` 1 TiB vs separate
  `plex-*-hdd-pvc` for `/tv`,`/movies`), so each seeding torrent is a full duplicate in the 1 TiB
  downloads PVC until removed.
