import { z } from "zod";
import { SubtitlePolicySchema } from "./subtitle-policy.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Path = z.string().min(1).max(4096);
export const NativeSubtitleSnapshotSchema = z.strictObject({
  id: z.uuid(),
  assetId: z.uuid(),
  version: z.int().nonnegative(),
  ownershipEpoch: z.int().nonnegative(),
  state: z.literal("installed"),
  qualityStatus: z.enum(["accepted", "unverified", "rejected"]),
  storageKind: z.enum(["sidecar", "embedded"]),
  language: z.string().min(1).max(30),
  providerId: z.string().min(1),
  path: Path.nullable(),
  checksum: Hash.nullable(),
  videoChecksum: Hash,
  videoVersion: z.int().nonnegative(),
  forced: z.boolean().nullable(),
  hearingImpaired: z.boolean().nullable(),
  streamIndex: z.int().nonnegative().nullable(),
  codec: z.string().min(1).nullable(),
  provenance: z.json(),
  matchingEvidence: z.json(),
  contentChecksum: Hash.nullable(),
});
export type NativeSubtitleSnapshot = z.infer<
  typeof NativeSubtitleSnapshotSchema
>;

export const NativeFileIdentitySchema = z.strictObject({
  device: z.string().regex(/^\d+$/u),
  inode: z.string().regex(/^\d+$/u),
  mtimeNs: z.string().regex(/^-?\d+$/u),
  ctimeNs: z.string().regex(/^-?\d+$/u),
  ancestors: z
    .array(
      z.strictObject({
        path: Path,
        device: z.string().regex(/^\d+$/u),
        inode: z.string().regex(/^\d+$/u),
      }),
    )
    .min(1)
    .max(128),
});
export const NativeSubtitleEvidenceSchema = z.strictObject({
  id: z.uuid(),
  assetId: z.uuid(),
  snapshotHash: Hash,
  videoChecksum: Hash,
  canonicalPath: Path.nullable(),
  checksum: Hash.nullable(),
  sizeBytes: z.string().regex(/^\d+$/u).nullable(),
  identity: NativeFileIdentitySchema.nullable(),
  storageKind: z.enum(["sidecar", "embedded"]),
  qualityStatus: z.enum(["accepted", "unverified", "rejected"]),
  stream: z
    .strictObject({
      index: z.int().nonnegative(),
      codec: z.string().min(1),
      language: z.string().nullable(),
      forced: z.boolean().nullable(),
      hearingImpaired: z.boolean().nullable(),
    })
    .nullable(),
});
export type NativeSubtitleEvidence = z.infer<
  typeof NativeSubtitleEvidenceSchema
>;

export const NativeSubtitlePolicySnapshotSchema = z.strictObject({
  mediaId: z.uuid(),
  localPolicyId: z.uuid().nullable(),
  localVersion: z.int().min(-1),
  effective: z
    .strictObject({
      id: z.uuid(),
      mediaId: z.uuid(),
      version: z.int().nonnegative(),
      recoveryEpoch: z.int(),
      source: z.json(),
      rules: SubtitlePolicySchema,
    })
    .nullable(),
});
export type NativeSubtitlePolicySnapshot = z.infer<
  typeof NativeSubtitlePolicySnapshotSchema
>;
