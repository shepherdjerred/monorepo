import { z } from "zod";
import { CompensationPhysicalReferenceSchema } from "#shared/publication-proof/references.ts";
import {
  RecoveryClaimAcknowledgementSchema,
  RecoveryClaimProjectionSchema,
} from "./recovery-claims.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const PrepareRecoverySchema = z
  .object({
    mediaIds: z.array(z.uuid()).min(1).max(100),
  })
  .strict();
export const RecoveryIntentSchema = z.discriminatedUnion("intent", [
  z.object({ mediaId: z.uuid(), intent: z.literal("request") }).strict(),
  z
    .object({ mediaId: z.uuid(), intent: z.literal("no_longer_request") })
    .strict(),
  z
    .object({
      mediaId: z.uuid(),
      intent: z.literal("keep"),
      days: z.number().int().min(1).max(365),
    })
    .strict(),
]);
export const LegacyRespondRecoverySchema = z
  .object({
    scopeHash: Hash,
    declarations: z.array(RecoveryIntentSchema).min(1).max(100),
    acknowledgePending: z.literal(true),
  })
  .strict();
export const RespondRecoverySchema = LegacyRespondRecoverySchema.extend({
  subjectUserId: z.uuid().optional(),
  claimAcknowledgements: z
    .array(RecoveryClaimAcknowledgementSchema)
    .max(1000)
    .optional(),
});
export const RecoveryStoredResponseSchema = z.union([
  LegacyRespondRecoverySchema,
  RespondRecoverySchema.extend({
    schemaVersion: z.literal(2),
    subjectUserId: z.uuid(),
    claimAcknowledgements: z
      .array(RecoveryClaimAcknowledgementSchema)
      .max(1000),
    authority: z.strictObject({
      mode: z.enum(["self", "managed_owner"]),
      actorId: z.uuid(),
      actorVersion: z.number().int(),
      subjectUserId: z.uuid(),
      mappingVersion: z.number().int(),
    }),
  }),
]);
export const ReleaseRecoverySchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    scopeHash: Hash,
    responseHash: Hash,
    confirmHouseholdBaseline: z.literal(true),
    confirmExistingPins: z.literal(true),
    acknowledgeMissingHistory: z.literal(true),
  })
  .strict();
export const LegacyRecoveryScopeSchema = z
  .object({
    excludedUsers: z.array(
      z
        .object({
          id: z.uuid(),
          displayName: z.string(),
          version: z.number().int(),
          mappingVersion: z.number().int().nullable(),
          reason: z.literal("fresh_scope_denial_without_relevant_claim"),
        })
        .strict(),
    ),
    recoveryEpoch: z.number().int().nonnegative(),
    runtimeVersion: z.number().int().nonnegative(),
    media: z
      .array(
        z
          .object({
            id: z.uuid(),
            title: z.string(),
            kind: z.string(),
            sectionId: z.string().nullable(),
            version: z.number().int(),
            generation: z.number().int().nullable(),
            automationEpoch: z.number().int().nullable(),
          })
          .strict(),
      )
      .max(100),
    holds: z.array(
      z
        .object({
          mediaId: z.uuid(),
          version: z.number().int(),
          recoveryEpoch: z.number().int(),
          reason: z.string(),
          createdAt: z.iso.datetime(),
        })
        .strict(),
    ),
    users: z
      .array(
        z
          .object({
            id: z.uuid(),
            displayName: z.string(),
            plexAccountId: z.string(),
            version: z.number().int(),
            restricted: z.boolean(),
            role: z.string(),
            mappingVersion: z.number().int().nullable(),
            mappingKind: z.string().nullable(),
            serverMachineId: z.string().nullable(),
            permittedSectionIds: z.array(z.string()),
            permittedMediaKinds: z.array(z.string()),
            plexRestricted: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    assets: z
      .array(
        z
          .object({
            id: z.uuid(),
            version: z.number().int(),
            checksum: z.string().nullable(),
            state: z.string(),
            ownershipEpoch: z.number().int(),
            owned: z.boolean(),
            mediaIds: z.array(z.uuid()),
          })
          .strict(),
      )
      .max(100),
    // These safe database projections bind root coverage, exclusions and personal
    // holds without exposing credentials or treating them as proof of lost writes.
    requests: z.array(z.json()),
    coverage: z.array(z.json()),
    personalHolds: z.array(z.json()),
    handoffReceipts: z.array(
      z.object({ id: z.uuid(), planHash: Hash }).strict(),
    ),
    nativeReceipts: z
      .array(
        z.strictObject({
          id: z.uuid(),
          planHash: Hash,
          assetIds: z.array(z.uuid()),
          compensationReferences: z
            .array(CompensationPhysicalReferenceSchema)
            .min(1)
            .max(25)
            .optional(),
        }),
      )
      .default([]),
    blockers: z.array(z.string()),
  })
  .strict();
export const RecoverySubjectSchema =
  LegacyRecoveryScopeSchema.shape.users.element.extend({
    declarationAuthority: z.enum(["self", "managed_owner"]),
    applicableMediaIds: z.array(z.uuid()).max(100),
    claimAcknowledgements: z
      .array(RecoveryClaimAcknowledgementSchema)
      .max(1000),
    homeUserId: z.string().nullable(),
    serverAccountId: z.string().nullable(),
  });
export const RecoveryScopeV2Schema = LegacyRecoveryScopeSchema.extend({
  schemaVersion: z.literal(2),
  users: z.array(RecoverySubjectSchema).max(100),
  householdRoster: z.array(RecoverySubjectSchema).max(100),
  excludedPairs: z
    .array(
      z.strictObject({
        userId: z.uuid(),
        mediaId: z.uuid(),
        reason: z.literal("fresh_scope_denial_without_relevant_claim"),
      }),
    )
    .max(10_000),
  legacyClaims: z.array(RecoveryClaimProjectionSchema).max(1000),
});
export const RecoveryScopeSchema = z.union([
  LegacyRecoveryScopeSchema,
  RecoveryScopeV2Schema,
]);
export function isRecoveryScopeV2(scope: RecoveryScope) {
  return "schemaVersion" in scope;
}
export function respondentMediaIds(scope: RecoveryScope, userId: string) {
  return isRecoveryScopeV2(scope)
    ? (scope.users.find((user) => user.id === userId)?.applicableMediaIds ?? [])
    : scope.users.some((user) => user.id === userId)
      ? scope.media.map((media) => media.id)
      : [];
}
export const RecoveryResponseSchema = z
  .object({
    userId: z.uuid(),
    actorId: z.uuid(),
    createdAt: z.iso.datetime(),
    response: RecoveryStoredResponseSchema,
  })
  .strict();
export const RecoveryDetailSchema = z
  .object({
    id: z.uuid(),
    state: z.string(),
    version: z.number().int(),
    scopeHash: Hash,
    responseHash: Hash.nullable(),
    expiresAt: z.iso.datetime(),
    scope: RecoveryScopeSchema,
    responses: z.array(RecoveryResponseSchema),
    missingUserIds: z.array(z.uuid()),
    receiptId: z.uuid().nullable(),
  })
  .strict();
export const RecoveryListSchema = z
  .object({
    authority: z
      .object({
        mode: z.enum(["active", "observe", "uninitialized"]),
        ownershipConfirmed: z.boolean(),
        writerState: z.enum(["current", "missing", "revoked", "stale"]),
        storageState: z.enum(["current", "missing", "revoked", "stale"]),
      })
      .strict()
      .nullable(),
    holds: z.array(
      z
        .object({ mediaId: z.uuid(), title: z.string(), reason: z.string() })
        .strict(),
    ),
    reviews: z.array(
      z
        .object({
          id: z.uuid(),
          state: z.string(),
          createdAt: z.iso.datetime(),
          titles: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();
export type RecoveryScope = z.infer<typeof RecoveryScopeSchema>;
export type RecoveryDetail = z.infer<typeof RecoveryDetailSchema>;
