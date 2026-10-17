import { z } from "zod";
import type { ResolvedProfile } from "#domain/resolved-contract.ts";
import type { ResolvedEvidence } from "#domain/resolved-evidence.ts";

export const MediaKindSchema = z.enum(["movie", "series", "season", "episode"]);
export const AvailabilitySchema = z.enum([
  "wanted",
  "searching",
  "downloading",
  "validating",
  "importing",
  "available",
  "quarantined",
  "removed",
]);
export const UserRoleSchema = z.enum(["owner", "member"]);
export const IdentifierSchema = z.string().min(1).max(200);
export const VersionSchema = z.number().int().nonnegative();
export const LanguageSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

export const MediaItemSchema = z.object({
  id: IdentifierSchema,
  kind: MediaKindSchema,
  title: z.string().min(1),
  year: z.number().int().nullable(),
  parentId: IdentifierSchema.nullable(),
  seasonNumber: z.number().int().nonnegative().nullable(),
  episodeNumber: z.number().int().nonnegative().nullable(),
  availability: AvailabilitySchema,
  catalogState: z.enum(["pending", "ready"]).optional(),
  version: VersionSchema,
});
export const UserSchema = z.object({
  id: IdentifierSchema,
  plexAccountId: z.string().min(1),
  displayName: z.string().min(1),
  role: UserRoleSchema,
  restricted: z.boolean(),
  version: VersionSchema,
});
export const CreateRequestSchema = z
  .object({
    mediaId: IdentifierSchema,
    requesterUserId: z.uuid().optional(),
    subtitleLanguages: z.array(LanguageSchema).max(20).default([]),
    includeFutureEpisodes: z.boolean().optional(),
    includeSpecials: z.boolean().default(false),
  })
  .strict();
export const RemovalConfirmationSchema = z
  .object({
    media: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          version: z.number().int(),
          generation: z.number().int(),
        })
        .strict(),
    ),
    assets: z.array(
      z
        .object({
          id: z.string(),
          version: z.number().int(),
          checksum: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const MediaActionSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("keep"), expectedVersion: VersionSchema })
    .strict(),
  z
    .object({ action: z.literal("pin"), expectedVersion: VersionSchema })
    .strict(),
  z
    .object({ action: z.literal("unpin"), expectedVersion: VersionSchema })
    .strict(),
  z
    .object({ action: z.literal("restore"), expectedVersion: VersionSchema })
    .strict(),
  z
    .object({
      action: z.literal("remove"),
      expectedVersion: VersionSchema,
      confirmation: RemovalConfirmationSchema.optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("retry"), expectedVersion: VersionSchema })
    .strict(),
  z
    .object({
      action: z.literal("select_release"),
      expectedVersion: VersionSchema,
      releaseId: IdentifierSchema,
      identityConfirmation: IdentityConfirmationSchema.optional(),
    })
    .strict(),
]);
export const RequestSchema = z.object({
  id: IdentifierSchema,
  userId: IdentifierSchema,
  mediaId: IdentifierSchema,
  active: z.boolean(),
  subtitleLanguages: z.array(LanguageSchema),
  includeFutureEpisodes: z.boolean(),
  includeSpecials: z.boolean(),
  version: VersionSchema,
});
export const OperationResultSchema = z.object({
  operationId: IdentifierSchema,
  status: z.enum(["queued", "running", "completed", "failed", "reconciling"]),
});
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    operationId: z.string().optional(),
  }),
});

export type MediaKind = z.infer<typeof MediaKindSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
export type MediaItem = z.infer<typeof MediaItemSchema>;
export type MediaUser = z.infer<typeof UserSchema>;
export type MediaRequest = z.infer<typeof RequestSchema>;
export type CreateRequest = z.infer<typeof CreateRequestSchema>;
export type MediaAction = z.infer<typeof MediaActionSchema>;
import { IdentityConfirmationSchema } from "./acquisition/preview.ts";

export type ReleaseAttributes = {
  id: string;
  providerId: string;
  title: string;
  mediaIds: readonly string[];
  identityConfidence: "exact" | "ambiguous" | "mismatch";
  quality: string;
  codec: string;
  audioLanguages: readonly string[];
  sizeBytes: number;
  scoreTags: readonly string[];
  resolvedEvidence?: ResolvedEvidence | undefined;
};

export type QualityProfile = {
  id: string;
  version: number;
  qualities: readonly string[];
  rejectedCodecs: readonly string[];
  requiredAudioLanguages: readonly string[];
  minimumBytes: number;
  maximumBytes: number;
  tagScores: Readonly<Record<string, number>>;
  cutoffQuality: string;
  cutoffScore: number;
  minimumScore: number;
  resolved?: ResolvedProfile | undefined;
};

export type MediaCommand = {
  operationId: string;
  kind: string;
  mediaId: string;
  generation: number;
};
