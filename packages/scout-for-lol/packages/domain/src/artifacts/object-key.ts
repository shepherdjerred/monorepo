import { z } from "zod";
import {
  type IsoInstant,
  type RiotMatchId,
  type S3ObjectKey,
  S3ObjectKeySchema,
} from "#src/identity/brands.ts";

const ArtifactAssetNameSchema = z.string().regex(/^[a-z\d][a-z\d-]*$/);
const ArtifactFileExtensionSchema = z.string().regex(/^[a-z\d]+$/);

/**
 * Build the object key for one match asset, mirroring the canonical layout
 * `games/yyyy/MM/dd/{matchId}/{asset}.{ext}` so every asset for a game lives
 * under one date-partitioned prefix.
 *
 * The date segments derive from `capturedAt` normalized to UTC, so the same
 * instant yields the same key on every host regardless of local timezone.
 */
export function buildMatchArtifactObjectKey(args: {
  matchId: RiotMatchId;
  assetName: string;
  extension: string;
  capturedAt: IsoInstant;
}): S3ObjectKey {
  const assetName = ArtifactAssetNameSchema.parse(args.assetName);
  const extension = ArtifactFileExtensionSchema.parse(args.extension);
  const capturedAtMs = Date.parse(args.capturedAt);
  if (Number.isNaN(capturedAtMs)) {
    throw new TypeError(
      `capturedAt is not a parseable instant despite carrying the IsoInstant brand: ${args.capturedAt}`,
    );
  }
  const capturedAtUtc = new Date(capturedAtMs);
  const year = String(capturedAtUtc.getUTCFullYear()).padStart(4, "0");
  const month = String(capturedAtUtc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(capturedAtUtc.getUTCDate()).padStart(2, "0");
  return S3ObjectKeySchema.parse(
    `games/${year}/${month}/${day}/${args.matchId}/${assetName}.${extension}`,
  );
}
