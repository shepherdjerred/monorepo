import { z } from "zod/v4";
import contract from "@shepherdjerred/the-storm/server/owned/plugins/TheStorm/rwf-archive.json" with { type: "json" };

/**
 * The Red Warfare recording archive contract, shared with the plugin through
 * `rwf-archive.json`: where recordings live, how a finished one is named, and
 * the marker the plugin's retention guard trusts before it deletes anything.
 */
export const RwfArchiveContract = z
  .object({
    version: z.literal(1),
    directory: z.literal("rwf-recordings"),
    recordingSuffix: z.literal(".rwfrec.gz"),
    partSuffix: z.literal(".rwfrec.gz.part"),
    markerSuffix: z.literal(".archived"),
    marker: z.literal("rwf-archive-v1"),
  })
  .strict()
  .parse(contract);

/** A finished recording's path under the recordings folder: `yyyy/MM/dd/<matchId>.rwfrec.gz`. */
export const RecordingPath = z
  .string()
  .regex(
    /^\d{4}\/\d{2}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.rwfrec\.gz$/u,
  );

export const RecordingRefSchema = z
  .object({ path: RecordingPath, bytes: z.number().int().nonnegative() })
  .strict();

/** One finished recording on the server. */
export type RecordingRef = z.infer<typeof RecordingRefSchema>;

export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

/** What the archiver wrote down beside a recording once its upload was confirmed. */
export type ArchiveMarker = {
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
};

/** The object key a recording is archived under. */
export function objectKey(path: string): string {
  return `the-storm/${RwfArchiveContract.directory}/${RecordingPath.parse(path)}`;
}

/** The marker's file text, exactly as the plugin's `Retention.Marker` reads it. */
export function encodeMarker(marker: ArchiveMarker): string {
  return `${RwfArchiveContract.marker}\t${marker.key}\t${Sha256.parse(marker.sha256)}\t${String(marker.bytes)}\n`;
}

/** Every valid marker line in `text`; anything else is ignored, as the plugin ignores it. */
export function decodeMarkers(text: string): ArchiveMarker[] {
  const markers: ArchiveMarker[] = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split("\t");
    if (fields.length !== 4 || fields[0] !== RwfArchiveContract.marker)
      continue;
    const [, key, sha256, bytes] = fields;
    const size = Number(bytes);
    if (
      key === undefined ||
      sha256 === undefined ||
      size < 0 ||
      !Sha256.safeParse(sha256).success ||
      !Number.isSafeInteger(size)
    )
      continue;
    markers.push({ key, sha256, bytes: size });
  }
  return markers;
}

export const RwfArchiveResultSchema = z
  .object({
    status: z.enum(["disabled", "sleeping", "archived"]),
    archived: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  })
  .strict();

/** How one archive run went. */
export type RwfArchiveResult = z.infer<typeof RwfArchiveResultSchema>;
