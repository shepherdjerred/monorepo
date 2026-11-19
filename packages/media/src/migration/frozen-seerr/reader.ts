import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { z } from "zod";
import {
  EvidenceHashSchema,
  MAX_MIGRATION_RECORDS,
  MigrationRecordSchema,
  MigrationSnapshotSchema,
} from "#shared/migration.ts";
import {
  requestRecord,
  RequestWire,
} from "#migration/capture/seerr-capture.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { finishCapture } from "#migration/capture/capture-passes.ts";

const MAX_SQLITE_BYTES = 256 * 1024 * 1024;
const Source = z.strictObject({
  sourceInstanceId: EvidenceHashSchema,
  sourceVersion: MigrationSnapshotSchema.shape.sourceVersion.refine(
    (value) => value !== "unknown",
  ),
  // Independent operator evidence must establish that the real writer stopped.
  writerStopped: z.literal(true),
});
type SourceInput = z.input<typeof Source>;
async function unappliedWal(path: string) {
  // A fresh Blob on each check avoids reusing cached metadata for an empty
  // sidecar that unexpectedly grew during the frozen read.
  const current = Bun.file(`${path}-wal`);
  return (await current.exists()) && current.size > 0;
}
const Count = z.object({
  count: z.int().nonnegative().max(MAX_MIGRATION_RECORDS),
});
const Request = z.object({
  id: z.int().positive(),
  type: RequestWire.shape.type,
  status: RequestWire.shape.status,
  mediaRowId: z.int().positive(),
  tmdbId: z.int().positive(),
  tvdbId: z.int().positive().nullable(),
  requesterSourceId: z.int().positive(),
  requesterRowId: z.int().positive(),
  plexId: z.int().positive().nullable(),
});
const Season = z.object({
  id: z.int().positive(),
  requestId: z.int().positive(),
  seasonNumber: z.int().nonnegative(),
  status: z.int().min(1).max(5),
});

/** Only four observed Seerr tables and these explicit columns are read.
 * LEFT JOIN plus checked counts rejects dangling references instead of hiding
 * requests. No source configuration, credentials, email or session is selected. */
function requests(db: Database) {
  const expected = Count.parse(
    db.query("SELECT count(*) AS count FROM media_request").get(),
  ).count;
  const rows = z
    .array(Request)
    .max(MAX_MIGRATION_RECORDS)
    .parse(
      db
        .query(
          `SELECT r.id, r.type, r.status, r.requestedById AS requesterSourceId,
          m.id AS mediaRowId, m.tmdbId, m.tvdbId,
          u.id AS requesterRowId, u.plexId
        FROM media_request AS r
        LEFT JOIN media AS m ON m.id = r.mediaId
        LEFT JOIN user AS u ON u.id = r.requestedById
        ORDER BY r.id LIMIT ${String(MAX_MIGRATION_RECORDS + 1)}`,
        )
        .all(),
    );
  const seasonCount = Count.parse(
    db.query("SELECT count(*) AS count FROM season_request").get(),
  ).count;
  const seasons = z
    .array(Season)
    .max(MAX_MIGRATION_RECORDS)
    .parse(
      db
        .query(
          `SELECT id, requestId, seasonNumber, status FROM season_request
        ORDER BY requestId, seasonNumber, id LIMIT ${String(MAX_MIGRATION_RECORDS + 1)}`,
        )
        .all(),
    );
  if (rows.length !== expected || seasons.length !== seasonCount)
    throw new Error("Frozen request source count changed");
  const ids = new Set(rows.map((row) => row.id));
  if (ids.size !== rows.length)
    throw new Error("Duplicate frozen request identity");
  const byRequest = new Map<number, z.infer<typeof Season>[]>();
  for (const season of seasons) {
    if (!ids.has(season.requestId))
      throw new Error("Frozen source has an orphaned season request");
    const selected = byRequest.get(season.requestId) ?? [];
    if (selected.some((item) => item.seasonNumber === season.seasonNumber))
      throw new Error("Frozen source has duplicate selected season identities");
    if (selected.length >= 1000)
      throw new Error("Frozen source exceeds selected season bound");
    selected.push(season);
    byRequest.set(season.requestId, selected);
  }
  return rows.map((row) => {
    if (row.requesterRowId !== row.requesterSourceId)
      throw new Error("Frozen requester identity is inconsistent");
    const record = requestRecord({
      id: row.id,
      type: row.type,
      status: row.status,
      requestedBy: { id: row.requesterSourceId },
      media: { tmdbId: row.tmdbId, tvdbId: row.tvdbId },
      seasons: byRequest.get(row.id) ?? [],
    });
    return MigrationRecordSchema.parse({
      ...record,
      plexAccountId: row.plexId === null ? null : String(row.plexId),
      // Source identity is genuine; current Media identity/consent is supplied
      // separately by the existing exact-capture owner requester binding.
      requesterMappingEvidenceHash: null,
    });
  });
}

function readImage(bytes: Uint8Array, source: z.infer<typeof Source>) {
  const startedAt = new Date().toISOString();
  const image = new Uint8Array(bytes);
  // A settled WAL-format main image cannot attach a sidecar after deserialize.
  // Change rollback mode only in the private memory copy, never original bytes.
  if (image[18] === 2 && image[19] === 2) {
    image[18] = 1;
    image[19] = 1;
  }
  const db = Database.deserialize(image, { readonly: true, strict: true });
  try {
    db.run("BEGIN");
    z.array(z.object({ quick_check: z.literal("ok") }))
      .length(1)
      .parse(db.query("PRAGMA quick_check").all());
    const first = requests(db);
    const second = requests(db);
    const pass = (records: typeof first) => ({
      records,
      version: source.sourceVersion,
      pages: 0,
      reason: "complete" as const,
    });
    const snapshot = finishCapture({
      sourceKind: "seerr",
      sourceInstanceId: source.sourceInstanceId,
      startedAt,
      endpoints: ["requests"],
      first: pass(first),
      second: pass(second),
    });
    return {
      snapshot,
      // Only source/current binding fields differ from the existing HTTP
      // request projection. This digest is diagnostic, never an API receipt.
      apiComparableDigest: recordDigest(
        snapshot.records.map((record) =>
          record.kind === "request"
            ? {
                ...record,
                plexAccountId: null,
                requesterMappingEvidenceHash: null,
              }
            : record,
        ),
      ),
    };
  } finally {
    db.close();
  }
}

/** One-time stopped-writer reader. It reads original bytes only; SQLite works
 * exclusively on a bounded private memory image. A nonempty WAL protects the
 * source rather than silently losing its final requests or checkpointing it. */
export async function readFrozenSeerr(path: string, input: SourceInput) {
  const source = Source.parse(input);
  const before = await stat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.size === 0n ||
    before.size > BigInt(MAX_SQLITE_BYTES)
  )
    throw new Error("Expected a bounded existing Seerr SQLite image");
  if (await unappliedWal(path))
    throw new Error("Frozen Seerr SQLite has unapplied WAL");
  const bytes = new Uint8Array(
    await Bun.file(path)
      .slice(0, MAX_SQLITE_BYTES + 1)
      .arrayBuffer(),
  );
  if (bytes.byteLength > MAX_SQLITE_BYTES)
    throw new Error("Frozen Seerr SQLite exceeds image bound");
  const sqliteDigest = createHash("sha256").update(bytes).digest("hex");
  const result = readImage(bytes, source);
  const after = await stat(path, { bigint: true });
  const finalDigest = createHash("sha256")
    .update(
      new Uint8Array(
        await Bun.file(path)
          .slice(0, MAX_SQLITE_BYTES + 1)
          .arrayBuffer(),
      ),
    )
    .digest("hex");
  if (
    sqliteDigest !== finalDigest ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    (await unappliedWal(path))
  )
    throw new Error("Frozen Seerr SQLite changed during its read");
  return {
    ...result,
    transport: "frozen-sqlite" as const,
    sqliteDigest,
    sqliteBytes: bytes.byteLength,
  };
}
