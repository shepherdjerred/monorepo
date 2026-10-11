import { Database } from "bun:sqlite";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { digest, uuid, type Client, type Manifest } from "./model";

const selection = `SELECT o.sequence,o.profile,o.id,o.path,o.bytes,o.revision,o.remote_revision,
  o.created_ms,o.modified_ms,o.related_path,p.size AS payload_size,p.revision AS payload_revision,
  s.written AS payload_written,s.sealed AS payload_sealed,
  CASE WHEN p.bytes IS NULL THEN 1 ELSE 0 END AS payload_retired
  FROM outbox AS o LEFT JOIN transfer_payloads AS p ON p.profile=o.profile AND p.id=o.bytes
  LEFT JOIN transfer_payload_state AS s ON s.row_id=p.row_id
  WHERE o.profile=? ORDER BY o.sequence,o.id`;

export function fingerprintOutbox(database: Database, profileID: string) {
  uuid.parse(profileID);
  return database.transaction(() => {
    z.object({ user_version: z.literal(12) }).parse(
      database.query("PRAGMA user_version").get(),
    );
    z.object({ count: z.literal(1) }).parse(
      database
        .query("SELECT COUNT(*) AS count FROM profiles WHERE id=?")
        .get(profileID),
    );
    const rows = z
      .array(z.record(z.string(), z.unknown()))
      .parse(database.query(selection).all(profileID));
    for (const row of rows) {
      if (row["bytes"] === null) continue;
      z.object({
        payload_size: z.number().int().nonnegative(),
        payload_revision: z.string().regex(/^[a-f0-9]{64}$/u),
        payload_written: z.number().int().nonnegative(),
        payload_sealed: z.literal(1),
        payload_retired: z.literal(0),
      }).parse(row);
      if (
        row["payload_written"] !== row["payload_size"] ||
        row["revision"] !== row["payload_revision"]
      )
        throw new Error(
          "Outbox payload is incomplete or differs from its immutable revision",
        );
    }
    // Operation identities and payload fingerprints remain memory-only. Evidence
    // exposes the bounded digest, never vault paths, payloads, or row contents.
    return { count: rows.length, sha256: digest(JSON.stringify(rows)) };
  })();
}

export async function outboxSnapshot(
  manifest: Manifest,
  client: Client,
  profileID: string,
) {
  if (manifest.clients === null) throw new Error("Apps are not prepared");
  const filename = path.join(
    manifest.clients[client].stateDirectory,
    "facet.sqlite3",
  );
  const stat = await lstat(filename);
  if ((await realpath(filename)) !== filename || !stat.isFile())
    throw new Error("Unsafe owned runtime database");
  const database = new Database(filename, { readonly: true, create: false });
  try {
    return fingerprintOutbox(database, profileID);
  } finally {
    database.close();
  }
}
