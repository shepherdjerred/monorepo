import { z } from "zod";
import { PlexBindingSnapshotSchema } from "#shared/plex-binding/contract.ts";
import { MovieEditionBirthAuthoritySchema } from "#shared/movie-editions/authority.ts";
import {
  MovieEditionHashSchema,
  MovieEditionScopeSchema,
} from "#shared/movie-editions/registry.ts";
import { MovieAcquisitionIdentityV2Schema } from "#shared/movie-editions/acquisition-v2.ts";
import {
  MovieFilePlanV2Schema,
  moviePlanScopeMatches,
  moviePlanMemberMatches,
} from "#shared/movie-editions/file-plan-v2.ts";

/** Actual owner-approved initial library policy, never a personal request or retrospective acquisition. */
export const LibraryMovieManagementAuthoritySchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    kind: z.literal("library_management"),
    ...MovieEditionScopeSchema.shape,
    receiptId: z.uuid(),
    planId: z.uuid(),
    planHash: MovieEditionHashSchema,
    selectionHash: MovieEditionHashSchema,
    actorId: z.uuid(),
    serverMachineId: z.string().min(1),
    sectionId: z.string().min(1),
    binding: PlexBindingSnapshotSchema,
    profileId: z.uuid(),
    profileVersionAtCapture: z.int().nonnegative(),
    targetGenerationAtCapture: z.int().nonnegative(),
    birthEpoch: z.int().nonnegative(),
  })
  .refine(
    (value) =>
      value.rootMediaId === value.mediaId &&
      value.binding.scope.mediaId === value.mediaId &&
      value.binding.scope.edition === value.edition,
    "Management must bind one movie edition",
  );

export const MovieAcquisitionIdentityV3Schema = z
  .strictObject({
    schemaVersion: z.literal(3),
    scope: MovieEditionScopeSchema,
    assessment: MovieAcquisitionIdentityV2Schema.shape.assessment,
    source: MovieAcquisitionIdentityV2Schema.shape.source,
    proof: MovieAcquisitionIdentityV2Schema.shape.proof,
    canonical: MovieAcquisitionIdentityV2Schema.shape.canonical,
    coverage: MovieAcquisitionIdentityV2Schema.shape.coverage,
    birthEpoch: MovieAcquisitionIdentityV2Schema.shape.birthEpoch,
    management: LibraryMovieManagementAuthoritySchema,
  })
  .refine(
    (value) =>
      value.scope.mediaId === value.canonical.mediaId &&
      value.coverage[0] === value.scope.mediaId &&
      value.management.mediaId === value.scope.mediaId &&
      value.management.edition === value.scope.edition &&
      value.management.birthEpoch === value.birthEpoch,
    "Management acquisition lost its exact birth scope",
  );

export const MovieFilePlanV3Schema = z
  .strictObject({
    ...MovieFilePlanV2Schema.shape,
    schemaVersion: z.literal(3),
    birth: LibraryMovieManagementAuthoritySchema,
  })
  .superRefine((plan, ctx) => {
    if (!moviePlanScopeMatches(plan) || !moviePlanMemberMatches(plan))
      ctx.addIssue({
        code: "custom",
        message: "Managed movie plan lost its exact birth, member or scope",
      });
  });

export const MovieAcquisitionIdentitySchema = z.union([
  MovieAcquisitionIdentityV2Schema,
  MovieAcquisitionIdentityV3Schema,
]);
export const MovieFilePlanSchema = z.union([
  MovieFilePlanV2Schema,
  MovieFilePlanV3Schema,
]);
export const MovieBirthAuthoritySchema = z.union([
  MovieEditionBirthAuthoritySchema,
  LibraryMovieManagementAuthoritySchema,
]);
export type MovieAcquisitionIdentity = z.infer<
  typeof MovieAcquisitionIdentitySchema
>;
export type MovieFilePlan = z.infer<typeof MovieFilePlanSchema>;
export type LibraryMovieManagementAuthority = z.infer<
  typeof LibraryMovieManagementAuthoritySchema
>;
