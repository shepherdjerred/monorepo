---
id: qbit-hitandrun-metadata-timeout-backfill
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-07-11_qbittorrent-hitandrun-seeding.md
source_marker: false
---

# qBittorrent H&R: backfill limits missed by on-add processing

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

## Production evidence

On 2026-07-27, a read-only API audit found nine nonzero-size torrents from a
single 2026-07-25 batch still using `seeding_time_limit=-2`. The current pod
also proves ordinary and short-delayed metadata hooks work. Misses can therefore
result from batch processing, pod replacement, or the existing five-minute
metadata timeout.

## Proposed fix

Add a periodic `--all` sweep (existing idempotent backfill mode) as a
CronJob / sidecar loop in the `media` namespace, so any torrent that missed the
add-hook window gets its size-based limit applied once metadata is available.

## Remaining

- [ ] Determine whether simultaneous adds, process replacement, or another
      qBittorrent AutoRun limitation caused the July 25 misses.
- [ ] Add an idempotent periodic `--all` sweep, or an equivalent targeted sweep
      for metadata-complete torrents still using `seeding_time_limit=-2`.
- [ ] Test delayed metadata, simultaneous additions, pod interruption, and
      visible sweep failures.
- [ ] Backfill the currently missed torrents and verify no metadata-complete
      torrent remains on `seeding_time_limit=-2`.

## Comment Log

- 2026-07-27 — Board audit confirmed the hook deliberately fails loudly after
  five minutes and no periodic sweep exists. The record's own activation rule
  requires a production occurrence, so it is deferred rather than ready
  backlog; no speculative cron is justified before that evidence exists.
- 2026-07-27 — A later read-only production audit found nine missed limits in
  one batch, satisfying the activation condition and returning the work to the
  active backlog.
