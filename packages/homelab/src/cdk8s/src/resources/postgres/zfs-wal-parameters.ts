/**
 * WAL and checkpoint settings shared by every Zalando PostgreSQL cluster.
 *
 * Every cluster's pgdata lives on a `zfs-ssd` dataset (OpenZFS, recordsize
 * 128k) on the production NVMe pool, and that drive's write budget is the
 * constraint these settings serve:
 *
 * - `full_page_writes = off`: full-page images exist to repair a page torn
 *   by a crash mid-write. ZFS is copy-on-write and commits each record
 *   atomically, and a record (>= 8K) always holds whole 8K Postgres pages,
 *   so a torn page cannot reach disk. With it on, the first change to each
 *   page after a checkpoint logged the whole 8K page: 11M full-page images in
 *   55 GB of Temporal WAL over nine days. Base backups still force full-page
 *   writes on for their duration, so `pg_basebackup` stays safe. Backups are
 *   Velero ZFS snapshots of the whole dataset, which are crash-consistent.
 * - `wal_init_zero = off`: zero-filling a new segment only guarantees
 *   allocated space on overwrite-in-place filesystems. On ZFS every write
 *   allocates fresh blocks anyway, so the 16 MB of zeros per segment is pure
 *   wear.
 * - `wal_recycle = off`: renaming old segments for reuse helps filesystems
 *   that overwrite in place. Copy-on-write allocates new blocks for a
 *   recycled file anyway, so the PostgreSQL docs recommend creating a new
 *   file instead on COW filesystems.
 * - `checkpoint_timeout = 15min` and a larger `max_wal_size`: fewer
 *   checkpoints mean each hot page is flushed (and its 128k record rewritten)
 *   less often. Crash recovery replays at most ~15 minutes of WAL.
 *
 * Archiving is untouched: Spilo's `archive_command` is `/bin/true` (no WAL-E
 * or WAL-G target), so it consumes no WAL and keeps nothing on disk.
 *
 * `pg_rewind` would need full-page writes, but every cluster runs one
 * instance, so there is never a former primary to rewind.
 *
 * postgres-operator v2 routes these through Patroni's dynamic configuration
 * (they are not in its local-only list), and Postgres applies all of them on
 * reload: changing them neither rolls the StatefulSet nor restarts Postgres.
 */
export const ZFS_WAL_PARAMETERS = {
  full_page_writes: "off",
  wal_init_zero: "off",
  wal_recycle: "off",
  checkpoint_timeout: "15min",
  // A soft cap: it triggers a checkpoint, it does not reserve space. Raise it
  // per cluster when a heavier writer would otherwise checkpoint on volume
  // instead of on the timeout.
  max_wal_size: "4GB",
} as const satisfies Record<string, string>;
