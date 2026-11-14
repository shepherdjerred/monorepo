import { Database } from "bun:sqlite";
import { z } from "zod";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { TautulliHistoryRowSchema } from "#shared/household/playback.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const StoredRow = z.object({
  id: z.int().positive(),
  user_id: z.int().nonnegative(),
  rating_key: z.int().nonnegative(),
  started: z.int().positive(),
  stopped: z.int().positive(),
  paused_counter: z.int().nonnegative().nullable(),
  view_offset: z.number().nonnegative().nullable(),
  metadata_duration: z.number().nonnegative().nullable(),
  full_title: z.string().min(1),
  grandparent_title: z.string().nullable(),
  media_type: z.string().min(1),
  live: z.union([z.literal(0), z.literal(1)]),
  platform: z.string(),
  player: z.string(),
  transcode_decision: z.enum(["direct play", "copy", "transcode", ""]),
});

function roundedEven(value: number) {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
}

/** Reconstruct Tautulli's ungrouped reporting values from actual stored offsets,
 * runtime and paused time. This never reconstructs offsets from percentages. */
export function frozenPlaybackRow(value: unknown) {
  const row = StoredRow.parse(value);
  const percent =
    row.live === 1
      ? 100
      : row.metadata_duration === 0
        ? 0
        : roundedEven(
            ((row.view_offset ?? 0.1) / (row.metadata_duration ?? 1)) * 100,
          );
  return TautulliHistoryRowSchema.parse({
    id: row.id,
    user_id: row.user_id,
    rating_key: row.rating_key,
    started: row.started,
    stopped: row.stopped,
    duration: row.stopped - row.started - (row.paused_counter ?? 0),
    percent_complete: Number.isNaN(percent) ? 0 : percent,
    full_title: row.full_title,
    grandparent_title: row.grandparent_title,
    media_type: row.media_type,
    platform: row.platform,
    player: row.player,
    transcode_decision:
      row.transcode_decision === "direct play"
        ? "direct_play"
        : row.transcode_decision === "copy"
          ? "direct_stream"
          : row.transcode_decision === "transcode"
            ? "transcode"
            : "unknown",
  });
}

/** Opens only a stopped writer's existing snapshot, in read-only SQLite mode. */
export async function readFrozenPlayback(path: string) {
  const before = await stat(path);
  if (!before.isFile() || before.size > 256 * 1024 * 1024)
    throw new Error("Expected a bounded existing SQLite snapshot");
  const wal = Bun.file(`${path}-wal`);
  if ((await wal.exists()) && wal.size > 0)
    throw new Error(
      "Use a consistent frozen SQLite backup rather than an image with unapplied WAL",
    );
  const digest = createHash("sha256")
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest("hex");
  const db = new Database(path, {
    readonly: true,
    create: false,
    strict: true,
  });
  try {
    const { rows, count } = readSnapshot(db);
    const after = await stat(path);
    const finalDigest = createHash("sha256")
      .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
      .digest("hex");
    if (
      digest !== finalDigest ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      ((await wal.exists()) && wal.size > 0)
    )
      throw new Error("Playback SQLite changed during its frozen read");
    return snapshotResult(rows, count, digest);
  } finally {
    db.close();
  }
}

/** Caller must independently attest the stopped source's WAL has settled. Bytes
 * are held only in memory; this never creates a credential-bearing temp file. */
export function readFrozenPlaybackBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0 || bytes.byteLength > 256 * 1024 * 1024)
    throw new Error("Expected a bounded complete frozen SQLite image");
  const digest = createHash("sha256").update(bytes).digest("hex");
  // sqlite3_deserialize cannot attach a WAL file. With the caller's explicit
  // settled-WAL proof, the main image is complete; select rollback mode only
  // in this disposable memory copy. Hash/identity always describe original bytes.
  const image = new Uint8Array(bytes);
  if (image[18] === 2 && image[19] === 2) {
    image[18] = 1;
    image[19] = 1;
  }
  const db = Database.deserialize(image, { readonly: true, strict: true });
  try {
    const { rows, count } = readSnapshot(db);
    return snapshotResult(rows, count, digest);
  } finally {
    db.close();
  }
}

function readSnapshot(db: Database) {
  db.run("BEGIN");
  const integrity = z
    .array(z.object({ quick_check: z.literal("ok") }))
    .length(1)
    .parse(db.query("PRAGMA quick_check").all());
  if (integrity.length !== 1)
    throw new Error("Frozen playback snapshot is invalid");
  const active = z
    .object({ count: z.int().nonnegative() })
    .parse(db.query("SELECT count(*) AS count FROM sessions").get());
  if (active.count !== 0)
    throw new Error(
      "Drain the actual Tautulli sessions before freezing history",
    );
  const count = z
    .object({ count: z.int().nonnegative().max(50_000) })
    .parse(
      db.query("SELECT count(*) AS count FROM session_history").get(),
    ).count;
  const rows = db
    .query(
      `SELECT h.id, h.user_id, m.rating_key, h.started, h.stopped, h.paused_counter,
      h.view_offset, h.live, h.media_type, h.platform, h.player, h.transcode_decision,
      m.duration AS metadata_duration, m.full_title, m.grandparent_title
      FROM session_history h LEFT JOIN session_history_metadata m ON m.id=h.id ORDER BY h.id`,
    )
    .all()
    .map((row) => frozenPlaybackRow(row));
  if (rows.length !== count)
    throw new Error("Frozen playback capture lost source rows");
  db.run("COMMIT");
  return { rows, count };
}

function snapshotResult(
  rows: ReturnType<typeof frozenPlaybackRow>[],
  count: number,
  digest: string,
) {
  const through = new Date().toISOString();
  if (rows.some((row) => row.stopped * 1000 >= Date.parse(through)))
    throw new Error(
      "Historical rows cross the actual snapshot observation boundary",
    );
  const manifest = rows
    .map((row) => ({ id: row.id, sha256: snapshotHash(row) }))
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: false }));
  return {
    rows,
    through,
    expectedSessions: count,
    snapshotDigest: snapshotHash(manifest),
    sqliteDigest: digest,
  };
}
