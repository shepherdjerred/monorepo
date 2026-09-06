import { z } from "zod";
import { defineVersionedCodec } from "#src/codec/versioned.ts";
import {
  IsoInstantSchema,
  S3ObjectKeySchema,
  Sha256DigestSchema,
} from "#src/identity/brands.ts";

/**
 * The raw capture assets stored for a match: the MatchV5 payload, its
 * timeline, and the pre-game spectator snapshot.
 */
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export const ArtifactKindSchema = z.enum(["match", "timeline", "prematch"]);

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
