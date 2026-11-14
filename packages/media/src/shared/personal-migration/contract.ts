import { z } from "zod";
import { EvidenceHashSchema } from "#shared/migration.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";

export const PersonalMigrationCursorSchema = z.strictObject({
  mediaId: z.uuid(),
  edition: MovieEditionKeySchema,
});
export const ReconcilePersonalMigrationSchema = z.strictObject({
  eventId: z.uuid(),
  after: PersonalMigrationCursorSchema.nullable(),
});

export const PersonalMigrationInputSchema = z.strictObject({
  captureIds: z
    .array(z.uuid())
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
  movieEditions: z
    .array(
      z.strictObject({
        mediaId: z.uuid(),
        edition: MovieEditionKeySchema,
      }),
    )
    .max(1000)
    .refine(
      (items) =>
        new Set(items.map((item) => item.mediaId)).size === items.length,
    ),
  historyOnly: z
    .array(EvidenceHashSchema)
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const ApplyPersonalMigrationSchema = PersonalMigrationInputSchema.extend(
  {
    previewHash: EvidenceHashSchema,
    acknowledgeExistingLibraryKeep: z.literal(true),
    acknowledgeTemporaryFollowingClaims: z.literal(true),
  },
);

export const PersonalMigrationClaimSchema = z.strictObject({
  captureId: z.uuid(),
  provenanceKey: EvidenceHashSchema,
  sourceId: z.string(),
  requesterSourceId: z.string(),
  sourceStatus: z.int().min(1).max(5).nullable(),
  disposition: z.enum(["import", "history", "existing", "blocked"]),
  reason: z.string().nullable(),
  userId: z.uuid().nullable(),
  bindingId: z.uuid().nullable(),
  bindingRevision: z.int().nullable(),
  mediaIds: z.array(z.uuid()).max(1000),
  edition: MovieEditionKeySchema.nullable(),
  keepingPolicy: z.literal("temporary"),
  interestState: z.literal("following"),
});
export type PersonalMigrationClaim = z.infer<
  typeof PersonalMigrationClaimSchema
>;

export const ImportedPersonalClaimSchema = z.strictObject({
  requestId: z.uuid(),
  mediaId: z.uuid(),
  userId: z.uuid(),
  edition: MovieEditionKeySchema,
  captureId: z.uuid(),
  provenanceKey: EvidenceHashSchema,
  sourceId: z.string(),
  sourceStatus: z.int().min(1).max(5),
  needsAcquisitionChoice: z.boolean(),
});
export const ImportedPersonalClaimsSchema = z
  .array(
    ImportedPersonalClaimSchema.extend({
      sourceKind: z.enum(["seerr", "overseerr", "jellyseerr"]),
      sourceFulfilled: z.boolean(),
    }),
  )
  .max(50_000);
export type ImportedPersonalClaim = z.infer<
  typeof ImportedPersonalClaimsSchema
>[number];
