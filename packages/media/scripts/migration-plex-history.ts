import { parseArgs } from "node:util";
import { z } from "zod";
import {
  PLEX_HISTORICAL_VIEW_BATCH_LIMIT,
  PLEX_HISTORICAL_VIEW_MAX_BYTES,
  PlexHistoricalViewImportSchema,
  PlexHistoricalViewRowSchema,
  type PlexHistoricalViewImport,
} from "#shared/household/plex-history.ts";

const usage =
  "Feed successful migration-plex-history.sql JSON to stdin and pipe these private NDJSON request bodies to the importer.";

function encodeBatches(batch: PlexHistoricalViewImport): string[] {
  const body = JSON.stringify(PlexHistoricalViewImportSchema.parse(batch));
  if (Buffer.byteLength(body) <= PLEX_HISTORICAL_VIEW_MAX_BYTES) return [body];
  if (batch.rows.length === 1)
    throw new Error("A single Plex view exceeds the import request size");
  const middle = Math.floor(batch.rows.length / 2);
  return [
    ...encodeBatches({ ...batch, rows: batch.rows.slice(0, middle) }),
    ...encodeBatches({ ...batch, rows: batch.rows.slice(middle) }),
  ];
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: { "server-machine-id": { type: "string" } },
    });
    const serverMachineId =
      PlexHistoricalViewImportSchema.shape.serverMachineId.parse(
        values["server-machine-id"],
      );
    const stdin = await Bun.stdin.text();
    const input = stdin.trim();
    // The SQLite JSON shell emits zero bytes for a successful empty SELECT.
    const rows = z
      .array(PlexHistoricalViewRowSchema)
      .parse(input === "" ? [] : JSON.parse(input));
    const sourceIds = new Set(
      rows.map((row) => `${row.source}:${String(row.sourceViewId)}`),
    );
    if (sourceIds.size !== rows.length)
      throw new Error("Plex history contains duplicate source view identities");

    const batches: string[] = [];
    for (
      let offset = 0;
      offset < rows.length;
      offset += PLEX_HISTORICAL_VIEW_BATCH_LIMIT
    ) {
      const batch = {
        serverMachineId,
        rows: rows.slice(offset, offset + PLEX_HISTORICAL_VIEW_BATCH_LIMIT),
      };
      batches.push(...encodeBatches(batch));
    }
    for (const batch of batches) process.stdout.write(`${batch}\n`);
    console.error(
      `Prepared ${String(rows.length)} Plex views in ${String(batches.length)} import batches.`,
    );
  } catch {
    console.error(`Plex history batch preparation failed. ${usage}`);
    process.exitCode = 1;
  }
}
