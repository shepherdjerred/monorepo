/**
 * Every distinct identity the corpus has ever recorded, and the last handle it
 * knew for each.
 *
 * This is the only pass that needs the cluster. Its output is a file the
 * harvest can work from on a laptop for days without a tunnel back to S3.
 *
 * It runs once. Every object written since each environment's key swap is
 * already new-domain — prod's last old-domain object dates to
 * 2026-09-13T05:07:05Z — so the set of old-domain identities is closed and
 * cannot grow while the harvest runs.
 */

import type { S3Client } from "@aws-sdk/client-s3";
import { foldSightings, sightingsIn } from "./extract.ts";
import { listRawObjects, scanObjects } from "./scan.ts";

export type InventoryRow = {
  oldPuuid: string;
  /** The handle the payload recorded. A cross-check, never the mapping. */
  archivedRiotId: string | null;
};

export type InventoryResult = {
  rows: InventoryRow[];
  objectsRead: number;
  objectsFailed: number;
  withoutRiotId: number;
};

export async function buildInventory(
  client: S3Client,
  bucket: string,
  prefix?: string,
): Promise<InventoryResult> {
  console.log(
    `inventory: listing ${bucket}${prefix === undefined ? "" : ` under ${prefix}`}`,
  );
  const objects = await listRawObjects(client, bucket, prefix);
  console.log(`  ${objects.length.toString()} raw JSON objects`);

  const folded = new Map<string, { riotId: string | null; at: number }>();
  const report = await scanObjects(
    client,
    objects,
    (object, body) => {
      const parsed: unknown = JSON.parse(body);
      foldSightings(folded, sightingsIn(object.kind, parsed));
      return true;
    },
    { bucket, label: bucket },
  );

  const rows: InventoryRow[] = [];
  let withoutRiotId = 0;
  for (const [oldPuuid, seen] of folded) {
    if (seen.riotId === null) {
      withoutRiotId++;
    }
    rows.push({ oldPuuid, archivedRiotId: seen.riotId });
  }
  rows.sort((a, b) => (a.oldPuuid < b.oldPuuid ? -1 : 1));

  return {
    rows,
    objectsRead: report.read,
    objectsFailed: report.failed,
    withoutRiotId,
  };
}

/** One JSON object per line, so the file streams and diffs sanely. */
export function serializeInventory(rows: readonly InventoryRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export function parseInventory(text: string): InventoryRow[] {
  const rows: InventoryRow[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const parsed: unknown = JSON.parse(line);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(`Inventory line is not an object: ${line.slice(0, 80)}`);
    }
    const record: Record<string, unknown> = { ...parsed };
    const oldPuuid = record["oldPuuid"];
    const archived = record["archivedRiotId"];
    if (typeof oldPuuid !== "string" || oldPuuid === "") {
      throw new Error(`Inventory line has no oldPuuid: ${line.slice(0, 80)}`);
    }
    rows.push({
      oldPuuid,
      archivedRiotId: typeof archived === "string" ? archived : null,
    });
  }
  return rows;
}
