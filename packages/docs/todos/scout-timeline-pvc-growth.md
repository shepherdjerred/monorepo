---
id: scout-timeline-pvc-growth
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/plans/2026-07-04_scout-report-lake-duckdb.md
---

# Scout SQLite timeline mirror will exhaust the PVC well before 10x scale

Measured 2026-07-04 (prod pod, read-only):

- `db.sqlite` is 11 GB on a 24 Gi PVC; **~78% of it is
  `StoredMatchTimeline.rawJson`** (13,187 timelines, ~690 KB average) that
  nothing in the report lake reads.
- Grafana (`kubelet_volume_stats_used_bytes`, June 8 – July 4): growth is
  **62 MB/day ≈ 1.9 GB/month** → ~7.8 months of headroom at today's ingest
  (~2,260 matches/month).
- At the 10x design target the same mirror costs ~19 GB/month — the PVC
  fills in **~24 days**. This is a hard prerequisite for 10x, independent
  of the report-lake migration.

Options (pick one before scale grows):

1. **Stop mirroring timelines in SQLite** — timelines already live in S3
   (`games/<date>/<matchId>/timeline.json`); make S3 the only timeline
   store and drop `StoredMatchTimeline.rawJson` (keep the row as an index
   if useful). Frees ~8.7 GB immediately and removes the dominant growth
   term.
2. Resize the PVC (kicks the can; ZFS-NVMe pool capacity applies).
3. Compress rawJson columns (zstd via app-level encoding) — ~5-10x on
   timeline JSON, but adds read complexity everywhere.

Note: SQLite does not return freed pages without `VACUUM`; plan a one-off
`VACUUM` (needs ~2x transient space or an offline copy) when option 1 lands.

## Remaining

- [ ] Complete and verify the work described in `Scout SQLite timeline mirror will exhaust the PVC well before 10x scale`.
