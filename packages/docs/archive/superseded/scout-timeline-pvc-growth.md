---
id: scout-timeline-pvc-growth
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-07-04_scout-report-lake-duckdb.md
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

## Consolidation

The selected fix was the S3-canonical cutover. PR #1514 removed
`StoredMatchTimeline` together with the other six report-store tables, so the
unused timeline JSON mirror and its dominant SQLite growth term no longer
exist.

The implementation and schema evidence are consolidated in
`packages/docs/archive/completed/scout-report-lake-fact-table-drop.md`; this
duplicate risk card is retained only as historical capacity evidence.

## Comment Log

### 2026-07-27 — in-progress board audit

- Closed as a duplicate of the completed report-store table drop.
