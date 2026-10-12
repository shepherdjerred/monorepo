import { z } from "zod";
import { defineVersionedCodec } from "#src/codec/versioned.ts";
import {
  IsoInstantSchema,
  S3ObjectKeySchema,
  Sha256DigestSchema,
} from "#src/identity/brands.ts";

/**
 * The raw capture assets stored for a match: the MatchV5 payload, its
 * timeline, the pre-game spectator snapshot, and — for a match whose result
 * came from the Scout Client — the client's own post-game bundle, kept
 * exactly as the League client reported it so the converted match can be
 * rebuilt from it.
 */
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export const ArtifactKindSchema = z.enum([
  "match",
  "timeline",
  "prematch",
  "client_bundle",
]);

/**
 * The artifacts the report lake projects. A client bundle is evidence only:
 * the lake reads the match converted from it, never the bundle itself, so it
 * owes the lake nothing and must not count as lake backlog.
 */
export type LakeArtifactKind = z.infer<typeof LakeArtifactKindSchema>;
export const LakeArtifactKindSchema = ArtifactKindSchema.exclude([
  "client_bundle",
]);

/**
 * Descriptor for one stored artifact: where it lives, what exactly was
 * stored (content-addressed by digest), and when it was captured.
 */
export type ArtifactDescriptor = z.infer<typeof ArtifactDescriptorSchema>;
export const ArtifactDescriptorSchema = z.strictObject({
  kind: ArtifactKindSchema,
  key: S3ObjectKeySchema,
  digest: Sha256DigestSchema,
  bytes: z.number().int().nonnegative(),
  contentType: z.string().min(1),
  capturedAt: IsoInstantSchema,
});

export const artifactDescriptorCodec = defineVersionedCodec({
  kind: "artifact-descriptor",
  version: 1,
  schema: ArtifactDescriptorSchema,
});
