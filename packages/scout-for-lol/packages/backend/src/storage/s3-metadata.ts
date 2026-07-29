import { z } from "zod";

const PrintableAsciiSchema = z
  .string()
  .regex(
    /^[\u{20}-\u{7E}]*$/u,
    "S3 metadata must contain printable ASCII only",
  );

const S3MetadataSchema = z.record(PrintableAsciiSchema, PrintableAsciiSchema);

const TrackedPlayerCountSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/u, "Tracked player count must be a decimal integer")
  .transform(Number)
  .pipe(z.number().int().nonnegative());

export function validateS3Metadata(
  metadata: Record<string, string>,
): Record<string, string> {
  return S3MetadataSchema.parse(metadata);
}

export function trackedPlayerCountMetadata(
  trackedPlayerAliases: readonly string[],
): { trackedPlayerCount: string } {
  return {
    trackedPlayerCount: trackedPlayerAliases.length.toString(),
  };
}

export function getTrackedPlayerCount(
  metadata: ReadonlyMap<string, string>,
): number {
  const trackedPlayerCount = metadata.get("trackedplayercount");
  if (trackedPlayerCount !== undefined) {
    return TrackedPlayerCountSchema.parse(trackedPlayerCount);
  }

  const trackedPlayers = metadata.get("trackedplayers") ?? "";
  return trackedPlayers
    .split(",")
    .map((player) => player.trim())
    .filter((player) => player.length > 0).length;
}
