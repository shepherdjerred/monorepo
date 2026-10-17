import { z } from "zod";
import { EvidenceHashSchema, SourceKindSchema } from "./migration.ts";

export const LegacyIdentitySchema = z.strictObject({
  userId: z.uuid(),
  userVersion: z.int().nonnegative(),
  plexAccountId: z.string(),
  kind: z.enum(["account", "managed"]),
  version: z.int().nonnegative(),
  serverMachineId: z.string().min(1),
  serverAccountId: z.string().nullable(),
  homeUserId: z.string().nullable(),
  permittedSectionIds: z.array(z.string()),
  permittedMediaKinds: z.array(z.string()),
  restricted: z.boolean(),
  plexRestricted: z.boolean(),
});
export const LegacyRequesterBindingSchema = z.strictObject({
  id: z.uuid(),
  sourceKind: SourceKindSchema,
  sourceInstanceId: EvidenceHashSchema,
  requesterSourceId: z.string(),
  captureId: z.uuid(),
  captureHash: EvidenceHashSchema,
  requesterEvidenceHash: EvidenceHashSchema,
  userId: z.uuid(),
  identitySnapshot: LegacyIdentitySchema,
  actorId: z.uuid(),
  revision: z.int().positive(),
  previousId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  provenance: z.literal("owner_declared_identity_only"),
});
export const BindLegacyRequesterSchema = z.strictObject({
  captureId: z.uuid(),
  requesterSourceId: z.string().regex(/^[\w:.-]{1,200}$/u),
  requesterEvidenceHash: EvidenceHashSchema,
  userId: z.uuid(),
  expectedRevision: z.int().nonnegative(),
  acknowledgeIdentityOnly: z.literal(true),
});
export const LegacyRequesterListSchema = z.strictObject({
  captureId: z.uuid(),
  captureHash: EvidenceHashSchema,
  sourceKind: SourceKindSchema,
  sourceInstanceId: EvidenceHashSchema,
  requesters: z
    .array(
      z.strictObject({
        requesterSourceId: z.string(),
        requesterEvidenceHash: EvidenceHashSchema,
        requestCount: z.int().positive(),
        latestRevision: z.int().nonnegative(),
        binding: LegacyRequesterBindingSchema.nullable(),
      }),
    )
    .max(100),
  targets: z
    .array(
      z.strictObject({
        userId: z.uuid(),
        displayName: z.string(),
        identity: LegacyIdentitySchema,
        eligible: z.boolean(),
      }),
    )
    .max(100),
});
export const RecoveryClaimIdentitySchema = z.strictObject({
  captureId: z.uuid(),
  captureHash: EvidenceHashSchema,
  sourceKind: SourceKindSchema,
  sourceInstanceId: EvidenceHashSchema,
  provenanceKey: EvidenceHashSchema,
  recordDigest: EvidenceHashSchema,
  requesterSourceId: z.string(),
  bindingId: z.uuid(),
  bindingRevision: z.int().positive(),
  userId: z.uuid(),
});
export const RecoveryClaimProjectionSchema = RecoveryClaimIdentitySchema.extend(
  {
    latestBindingRevision: z.int().positive(),
    mediaIds: z.array(z.uuid()).min(1).max(100),
    outsideMediaIds: z.array(z.uuid()).max(1000),
    sourceScope: z.enum(["movie", "series", "season"]),
    seasons: z.array(z.int().nonnegative()).max(1000),
  },
);
export const RecoveryClaimAccountingSchema = RecoveryClaimIdentitySchema.extend(
  { mediaIds: z.array(z.uuid()).min(1).max(100) },
);
export const RecoveryClaimAcknowledgementSchema = z.strictObject({
  provenanceKey: EvidenceHashSchema,
  captureHash: EvidenceHashSchema,
  recordDigest: EvidenceHashSchema,
  bindingId: z.uuid(),
  bindingRevision: z.int().positive(),
  mediaIds: z.array(z.uuid()).min(1).max(100),
  latestBindingRevision: z.int().positive(),
});
export type RecoveryClaimProjection = z.infer<
  typeof RecoveryClaimProjectionSchema
>;
export type RecoveryClaimAccounting = z.infer<
  typeof RecoveryClaimAccountingSchema
>;
