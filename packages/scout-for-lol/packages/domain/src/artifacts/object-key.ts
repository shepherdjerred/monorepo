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
 * The identity segment of a prematch object key. The canonical writer keys
 * prematch snapshots by the spectator game id, or by a fuller natural
 * identity when a numeric game id is not globally unique — so this is a key
 * segment, not a {@link RiotMatchId}: one path segment of safe characters.
 */
const PrematchResourceIdSchema = z.string().regex(/^[a-z\d][\w-]*$/i);

/**
 * Derive the `yyyy/MM/dd` key segment from an instant normalized to UTC, so
 * the same instant yields the same key on every host regardless of local
 * timezone.
 */
function utcDatePath(capturedAt: IsoInstant): string {
  const capturedAtMs = Date.parse(capturedAt);
  if (Number.isNaN(capturedAtMs)) {
    throw new TypeError(
      `capturedAt is not a parseable instant despite carrying the IsoInstant brand: ${capturedAt}`,
    );
  }
  const capturedAtUtc = new Date(capturedAtMs);
  const year = String(capturedAtUtc.getUTCFullYear()).padStart(4, "0");
  const month = String(capturedAtUtc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(capturedAtUtc.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

/**
 * Build the object key for one post-game match asset, mirroring the canonical
 * layout `games/yyyy/MM/dd/{matchId}/{asset}.{ext}` so every asset for a game
 * lives under one date-partitioned prefix. This is the namespace for the
 * `match` and `timeline` artifact kinds; prematch snapshots are keyed by a
 * different identity and namespace — see {@link buildPrematchArtifactObjectKey}.
 */
export function buildMatchArtifactObjectKey(args: {
  matchId: RiotMatchId;
  assetName: string;
  extension: string;
  capturedAt: IsoInstant;
}): S3ObjectKey {
  const assetName = ArtifactAssetNameSchema.parse(args.assetName);
  const extension = ArtifactFileExtensionSchema.parse(args.extension);
  const datePath = utcDatePath(args.capturedAt);
  return S3ObjectKeySchema.parse(
    `games/${datePath}/${args.matchId}/${assetName}.${extension}`,
  );
}

/**
 * Build the object key for one prematch asset, mirroring the canonical layout
 * `prematch/yyyy/MM/dd/{resourceId}/{asset}.{ext}`. Prematch snapshots are
 * captured before a Riot match id exists, so they are keyed by the spectator
 * resource id, never by a match id.
 */
export function buildPrematchArtifactObjectKey(args: {
  resourceId: string;
  assetName: string;
  extension: string;
  capturedAt: IsoInstant;
}): S3ObjectKey {
  const resourceId = PrematchResourceIdSchema.parse(args.resourceId);
  const assetName = ArtifactAssetNameSchema.parse(args.assetName);
  const extension = ArtifactFileExtensionSchema.parse(args.extension);
  const datePath = utcDatePath(args.capturedAt);
  return S3ObjectKeySchema.parse(
    `prematch/${datePath}/${resourceId}/${assetName}.${extension}`,
  );
}
