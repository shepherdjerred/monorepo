import { z } from "zod";
import { RecoverySubjectSchema } from "#shared/recovery.ts";
import {
  RecoveryClaimAcknowledgementSchema,
  RecoveryClaimProjectionSchema,
  RecoveryClaimAccountingSchema,
} from "#shared/recovery-claims.ts";
import {
  MovieEditionScopeSchema,
  MovieEditionDefinitionRefSchema,
  MovieEditionHashSchema,
  MovieEditionKeySchema,
} from "./registry.ts";
import { MovieEditionChoiceAuditSchema } from "./authority.ts";
import {
  MoviePublicationReferenceV2Schema,
  MoviePublicationAssetV2Schema,
} from "./publication-v2.ts";
import { PlexBindingSnapshotSchema } from "#shared/plex-binding/contract.ts";
import { AvailabilitySchema } from "#shared/contract.ts";

const Version = z.int().nonnegative();
export const MovieHistoryRequestV3Schema = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  mediaId: z.uuid(),
  edition: MovieEditionKeySchema,
  version: Version,
  active: z.boolean(),
  excluded: z.boolean(),
  direct: z.boolean(),
  movieEditionChoiceId: z.uuid().nullable(),
  movieEditionChoiceRevision: Version,
  subtitleLanguages: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const MovieHistoryChoiceV3Schema = z.strictObject({
  id: z.uuid(),
  requestId: z.uuid(),
  choiceRevision: z.int().positive(),
  actorId: z.uuid(),
  subjectUserId: z.uuid(),
  rootMediaId: z.uuid(),
  edition: MovieEditionKeySchema,
  definitionVersion: z.literal(0),
  registryVersion: z.literal(1),
  requestVersionAtChoice: Version,
  authority: MovieEditionChoiceAuditSchema,
  createdAt: z.iso.datetime(),
});
export const MovieHistoryKeepV3Schema = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  mediaId: z.uuid(),
  edition: MovieEditionKeySchema,
  until: z.iso.datetime().nullable(),
  isPin: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const MovieHistoryScopeV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  scope: MovieEditionScopeSchema,
  definition: MovieEditionDefinitionRefSchema,
  registryVersion: z.literal(1),
  recoveryEpoch: Version,
  runtimeVersion: Version,
  media: z.strictObject({
    id: z.uuid(),
    title: z.string(),
    version: Version,
    kind: z.literal("movie"),
  }),
  target: z.strictObject({
    mediaId: z.uuid(),
    edition: MovieEditionKeySchema,
    editionRootId: z.uuid(),
    version: Version,
    generation: Version,
    automationEpoch: z.int(),
    profileId: z.uuid().nullable(),
    desiredPresence: z.boolean(),
    monitoring: z.boolean(),
    libraryMonitoring: z.boolean(),
    availability: AvailabilitySchema,
    intentionallyRemovedAt: z.iso.datetime().nullable(),
  }),
  profile: z
    .strictObject({
      id: z.uuid(),
      version: Version,
      rulesHash: MovieEditionHashSchema,
    })
    .nullable(),
  hold: z.strictObject({
    mediaId: z.uuid(),
    edition: MovieEditionKeySchema,
    version: Version,
    recoveryEpoch: Version,
    reason: z.enum([
      "migration_household_intent_review_required",
      "legacy_claim_reconciliation_required",
    ]),
    createdAt: z.iso.datetime(),
  }),
  access: z.strictObject({
    serverMachineId: z.string().min(1),
    movieSectionId: z.string().min(1),
  }),
  adoption: z.strictObject({
    receiptId: z.uuid(),
    planId: z.uuid(),
    planHash: MovieEditionHashSchema,
    assetId: z.uuid(),
    bindingHash: MovieEditionHashSchema,
    actorId: z.uuid(),
    assetRaw: z.string().min(2),
    planRaw: z.string().min(2),
  }),
  publication: MoviePublicationReferenceV2Schema,
  asset: MoviePublicationAssetV2Schema,
  binding: PlexBindingSnapshotSchema,
  requests: z.array(MovieHistoryRequestV3Schema).max(100),
  choices: z.array(MovieHistoryChoiceV3Schema).max(100),
  personalHolds: z.array(MovieHistoryKeepV3Schema).max(100),
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
    .max(100),
  legacyClaims: z.array(RecoveryClaimProjectionSchema).max(1000),
  blockers: z.array(z.string()),
});

const CurrentChoice = z.strictObject({
  requestId: z.uuid(),
  requestVersion: Version,
  choiceId: z.uuid(),
  choiceRevision: z.int().positive(),
  subtitleLanguages: z.array(z.string()),
});
export const MovieHistoryDeclarationV3Schema = z.discriminatedUnion("intent", [
  z.strictObject({
    intent: z.literal("request"),
    currentChoice: CurrentChoice,
  }),
  z.strictObject({
    intent: z.literal("keep"),
    currentChoice: CurrentChoice,
    currentKeep: MovieHistoryKeepV3Schema,
  }),
  z.strictObject({ intent: z.literal("no_longer_request") }),
]);
export const PrepareMovieHistoryV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  scope: MovieEditionScopeSchema,
  expected: z.strictObject({
    mediaVersion: Version,
    targetVersion: Version,
    holdVersion: Version,
    definition: MovieEditionDefinitionRefSchema,
  }),
});
export const RespondMovieHistoryV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  scope: MovieEditionScopeSchema,
  scopeHash: MovieEditionHashSchema,
  subjectUserId: z.uuid(),
  definition: MovieEditionDefinitionRefSchema,
  registryVersion: z.literal(1),
  declaration: MovieHistoryDeclarationV3Schema,
  claimAcknowledgements: z.array(RecoveryClaimAcknowledgementSchema).max(1000),
  acknowledgeMissingHistory: z.literal(true),
});
export const MovieHistoryStoredResponseV3Schema =
  RespondMovieHistoryV3Schema.extend({
    authority: z.strictObject({
      mode: z.enum(["self", "managed_owner"]),
      actorId: z.uuid(),
      actorVersion: Version,
      subjectUserId: z.uuid(),
      mappingVersion: Version,
    }),
  });
export const ReleaseMovieHistoryV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  scope: MovieEditionScopeSchema,
  expectedVersion: Version,
  scopeHash: MovieEditionHashSchema,
  responseHash: MovieEditionHashSchema,
  confirmHouseholdBaseline: z.literal(true),
  confirmExistingPins: z.literal(true),
  acknowledgeMissingHistory: z.literal(true),
});
/** A distinct object envelope cannot be consumed as historical array-shaped, id-only accounting. */
export const MovieHistoryClaimAccountingV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  scope: MovieEditionScopeSchema,
  claims: z.array(RecoveryClaimAccountingSchema).max(1000),
});
export const MovieHistoryDetailV3Schema = z.strictObject({
  id: z.uuid(),
  state: z.string(),
  version: Version,
  scopeHash: MovieEditionHashSchema,
  responseHash: MovieEditionHashSchema,
  expiresAt: z.iso.datetime(),
  scope: MovieHistoryScopeV3Schema,
  responses: z
    .array(
      z.strictObject({
        userId: z.uuid(),
        actorId: z.uuid(),
        response: MovieHistoryStoredResponseV3Schema,
        createdAt: z.iso.datetime(),
      }),
    )
    .max(100),
  missingUserIds: z.array(z.uuid()).max(100),
  receiptId: z.uuid().nullable(),
});
/** A member receives only their own declaration context, never the household ledger. */
export const MovieHistoryPersonalDetailV3Schema = z.strictObject({
  id: z.uuid(),
  state: z.string(),
  version: Version,
  scopeHash: MovieEditionHashSchema,
  expiresAt: z.iso.datetime(),
  scope: MovieEditionScopeSchema,
  definition: MovieEditionDefinitionRefSchema,
  registryVersion: z.literal(1),
  title: z.string(),
  subject: RecoverySubjectSchema,
  requests: z.array(MovieHistoryRequestV3Schema).max(100),
  choices: z.array(MovieHistoryChoiceV3Schema).max(100),
  personalHolds: z.array(MovieHistoryKeepV3Schema).max(100),
  response: MovieHistoryStoredResponseV3Schema.nullable(),
});
export const MovieHistoryCommandResultV3Schema = z.strictObject({
  recoveryReviewId: z.uuid(),
  recoveryReceiptId: z.uuid().optional(),
  operationId: z.uuid().optional(),
  status: z.literal("completed"),
  version: Version,
});
export function isMovieHistoryScopeV3(raw: unknown) {
  return z.object({ schemaVersion: z.literal(3) }).safeParse(raw).success;
}
export type MovieHistoryScopeV3 = z.infer<typeof MovieHistoryScopeV3Schema>;
export type MovieHistoryStoredResponseV3 = z.infer<
  typeof MovieHistoryStoredResponseV3Schema
>;
export type MovieHistoryDeclarationV3 = z.infer<
  typeof MovieHistoryDeclarationV3Schema
>;
