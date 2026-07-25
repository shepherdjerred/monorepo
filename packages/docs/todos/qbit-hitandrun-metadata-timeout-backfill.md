---
id: qbit-hitandrun-metadata-timeout-backfill
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/plans/2026-07-11_qbittorrent-hitandrun-seeding.md
source_marker: false
---

# qBittorrent H&R: periodic `--all` sweep for slow-metadata magnets

## Context

The `OnTorrentAdded` hook (`hitandrun-share-limit.sh`) waits up to
`METADATA_WAIT_SECONDS` (5 min) for a magnet's size metadata before computing
the per-torrent seeding-time limit. If metadata never resolves within that
window, `apply_limit` gives up **loudly** (logs an ERROR naming the hash and
instructing an operator to re-run `--all`) rather than persisting a wrong
`<=1GB` floor. There is intentionally no automatic backfill cron in this PR —
the hook is a fire-and-forget subprocess and wiring self-rescheduling retry
into it would add exactly the polling/cron infra the design avoids.

Greptile flagged this on PR #1454
(https://github.com/shepherdjerred/monorepo/pull/1454, review comment
3565009440): a 50GB+ torrent that also took >5 min to fetch metadata keeps
`seeding_time_limit=-2` (global 7-day cap) and can stop seeding before its H&R
requirement.

## When to act

Only if this edge case is observed in practice post-deploy (an ERROR log line
`still has no size metadata after ...s; skipping` correlated with a large
torrent that later got H&R-flagged).

## Proposed fix

Add a periodic `--all` sweep (existing idempotent backfill mode) as a
CronJob / sidecar loop in the `media` namespace, so any torrent that missed the
add-hook window gets its size-based limit applied once metadata is available.

## Remaining

- [ ] Complete and verify the work described in `qBittorrent H&R: periodic --all sweep for slow-metadata magnets`.
