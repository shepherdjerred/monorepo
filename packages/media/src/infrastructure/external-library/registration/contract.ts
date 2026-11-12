import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PlexClient } from "#integrations/plex.ts";

const Id = z.string().regex(/^[1-9]\d*$/u);
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const ExternalPlexObservationSchema = z.strictObject({
  serverMachineId: z.string().min(1),
  sectionId: Id,
  sectionType: z.enum(["movie", "show"]),
  canonicalPath: z.string().min(1).max(4096),
  sizeBytes: z.string().regex(/^[1-9]\d*$/u),
  observedEditionTitle: z.string().max(256).nullable(),
  root: z.strictObject({
    ratingKey: Id,
    kind: z.enum(["movie", "series"]),
    tmdbId: z.int().positive(),
    title: z.string().min(1),
    year: z.int().nullable(),
    guids: z.array(z.string()).max(100),
  }),
  members: z
    .array(
      z.strictObject({
        ratingKey: Id,
        partId: Id,
        guids: z.array(z.string()).max(100),
        parentRatingKey: Id.nullable(),
        seasonNumber: z.int().nonnegative().nullable(),
        episodeNumber: z.int().nonnegative().nullable(),
      }),
    )
    .min(1)
    .max(25),
});
export type ExternalPlexObservation = z.infer<
  typeof ExternalPlexObservationSchema
>;
export const ExternalRegistrationPlanSchema = z.strictObject({
  observation: ExternalPlexObservationSchema,
  root: z.strictObject({
    id: z.uuid(),
    version: z.int().nonnegative(),
    tmdbId: z.int().positive(),
    year: z.int().nullable(),
    catalogIdentityHash: Hash,
  }),
  members: z
    .array(
      z.strictObject({
        mediaId: z.uuid(),
        version: z.int().nonnegative(),
        parentId: z.uuid().nullable(),
        seasonNumber: z.int().nonnegative().nullable(),
        episodeNumber: z.int().nonnegative().nullable(),
        externalIdentityHash: Hash,
      }),
    )
    .min(1)
    .max(25),
  disposition: z.enum(["eligible", "already_registered", "protected"]),
  reason: z.string().nullable(),
  existingAssetId: z.uuid().nullable(),
  databaseHash: Hash,
});
export type ExternalRegistrationPlan = z.infer<
  typeof ExternalRegistrationPlanSchema
>;
export const ExternalLibraryPreviewSchema = z.strictObject({
  operationId: z.uuid(),
  previewHash: Hash,
  expiresAt: z.iso.datetime(),
  plan: ExternalRegistrationPlanSchema,
});
export type ExternalLibraryPreview = z.infer<
  typeof ExternalLibraryPreviewSchema
>;
export type ExternalLibrarySettings = {
  serverMachineId: string;
  sections: () => Promise<{ movie: string; series: string }>;
  ownerClient: (
    actor: MediaActor,
  ) => Promise<
    Pick<
      PlexClient,
      "machineIdentifier" | "sections" | "metadata" | "libraryPage"
    >
  >;
};
