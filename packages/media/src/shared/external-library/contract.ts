import { z } from "zod";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const DecimalId = z.string().regex(/^[1-9]\d*$/u);
export const ExternalLibraryMemberSchema = z.strictObject({
  mediaId: z.uuid(),
  ratingKey: DecimalId,
  partId: DecimalId,
  guids: z.array(z.string().min(1).max(2048)).max(100),
  seasonNumber: z.int().nonnegative().nullable(),
  episodeNumber: z.int().nonnegative().nullable(),
});

/** Observed external availability only: never an owned Plex binding or a cut assertion. */
export const ExternalLibraryRegistrationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.literal("plex"),
  registrationEventId: z.uuid(),
  registeredAt: z.iso.datetime(),
  serverMachineId: z.string().min(1),
  sectionId: DecimalId,
  sectionType: z.enum(["movie", "show"]),
  rootMediaId: z.uuid(),
  rootTmdbId: z.int().positive(),
  rootYear: z.int().nullable(),
  rootCatalogIdentityHash: Hash,
  edition: z.literal("default"),
  observedEditionTitle: z.string().max(256).nullable(),
  canonicalEdition: MovieEditionKeySchema.nullable(),
  editionConfidence: z.enum(["unknown", "explicit"]),
  members: z.array(ExternalLibraryMemberSchema).min(1).max(25),
  canonicalPath: z.string().min(1).max(4096),
  sizeBytes: z.string().regex(/^[1-9]\d*$/u),
});
export const EXTERNAL_LIBRARY_REGISTERED_EVENT = "external_library_registered";
export const ExternalLibraryRegistrationEventSchema = z.strictObject({
  registration: ExternalLibraryRegistrationSchema,
  registrationHash: Hash,
});
export type ExternalLibraryRegistration = z.infer<
  typeof ExternalLibraryRegistrationSchema
>;

export const ExternalLibraryPreviewInputSchema = z.strictObject({
  sectionType: z.enum(["movie", "show"]),
  ratingKey: DecimalId,
});
export const ExternalLibraryApplyInputSchema = z.strictObject({
  previewOperationId: z.uuid(),
  previewHash: Hash,
});
export type ExternalLibraryPreviewInput = z.infer<
  typeof ExternalLibraryPreviewInputSchema
>;
export type ExternalLibraryApplyInput = z.infer<
  typeof ExternalLibraryApplyInputSchema
>;
export const ExternalLibraryApplyResultSchema = z.strictObject({
  operationId: z.uuid(),
  status: z.literal("completed"),
  disposition: z.enum(["registered", "already_registered", "protected"]),
  reason: z.string().nullable(),
  assetId: z.uuid().nullable(),
  mediaIds: z.array(z.uuid()).max(25),
  externalOnly: z.literal(true),
});
