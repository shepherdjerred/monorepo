import { z } from "zod";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const HandoffSubtitleSchema = z.strictObject({
  id: z.uuid(),
  assetId: z.uuid(),
  provenanceKeys: z.array(Hash).min(1).max(100),
  managerCaptureId: z.uuid(),
  sourceInstanceId: Hash,
  sourceVideoPath: z.string().min(1).max(4096),
  sourcePath: z.string().min(1).max(4096).nullable(),
  canonicalPath: z.string().min(1).max(4096).nullable(),
  capturedChecksum: Hash.nullable(),
  language: z.string().min(1).max(30),
  forced: z.boolean().nullable(),
  hearingImpaired: z.boolean().nullable(),
  streamIndex: z.int().nonnegative().nullable(),
});
export const HandoffSubtitleEvidenceSchema = z.strictObject({
  id: z.uuid(),
  assetId: z.uuid(),
  checksum: Hash.nullable(),
  videoChecksum: Hash,
  canonicalPath: z.string().min(1).nullable(),
  storageKind: z.enum(["sidecar", "embedded"]),
  streamIndex: z.int().nonnegative().nullable(),
  codec: z.string().min(1).nullable(),
  qualityStatus: z.literal("unverified"),
  reasons: z.array(z.string()).min(1).max(20),
  // Embedded track evidence is tied to the inspected video; sidecar content is separately proved.
  identity: z.json().nullable(),
});
