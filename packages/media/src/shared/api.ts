import { z } from "zod";
import { ResolvedProfileSchema } from "#domain/resolved-contract.ts";
import { ResolvedEvidenceSchema } from "#domain/resolved-evidence.ts";
import {
  MediaItemSchema,
  RequestSchema,
  UserSchema,
  RemovalConfirmationSchema,
} from "./contract.ts";

export const DateTimeSchema = z
  .union([z.date(), z.iso.datetime()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));
export const CommandResultSchema = z.object({
  operationId: z.string().optional(),
  requestId: z.string().optional(),
  mediaId: z.string().optional(),
  profileId: z.string().optional(),
  userId: z.string().optional(),
  runId: z.uuid().optional(),
  handoffId: z.uuid().optional(),
  status: z.enum(["queued", "completed"]).optional(),
  version: z.number().int().optional(),
  restricted: z.boolean().optional(),
});
export const RequestListSchema = z.array(
  RequestSchema.extend({ media: MediaItemSchema }),
);
export const OperationListSchema = z.array(
  z.object({
    id: z.string(),
    kind: z.string(),
    targetId: z.string().nullable(),
    mediaId: z.string().nullable(),
    status: z.enum(["queued", "running", "completed", "failed", "reconciling"]),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  }),
);
export const RemovalListSchema = z.array(
  z.object({
    id: z.string(),
    mediaId: z.string(),
    state: z.string(),
    graceUntil: DateTimeSchema.nullable(),
    purgeAfter: DateTimeSchema.nullable(),
    media: z.object({
      title: z.string(),
      kind: z.string(),
      version: z.number().int(),
    }),
  }),
);
export const NotificationListSchema = z.array(
  z.object({
    id: z.string(),
    channel: z.string(),
    state: z.string(),
    version: z.number().int(),
    failureReason: z.string().nullable(),
    providerStatus: z.string().nullable(),
    attempts: z.number().int(),
    acceptedAt: DateTimeSchema.nullable(),
    createdAt: DateTimeSchema,
    event: z.object({ mediaId: z.string().nullable(), kind: z.string() }),
  }),
);
export const ProfileListSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    version: z.number().int(),
    rules: z.json(),
  }),
);
export const UserListSchema = z.array(UserSchema);
export const MediaDetailSchema = MediaItemSchema.extend({
  removalConfirmation: RemovalConfirmationSchema.optional(),
  children: z.array(MediaItemSchema),
  intent: z
    .object({
      generation: z.number().int(),
      desiredPresence: z.boolean(),
      monitoring: z.boolean(),
      profileId: z.string().nullable(),
      version: z.number().int(),
      intentionallyRemovedAt: DateTimeSchema.nullable(),
    })
    .nullable(),
  requests: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      subtitleLanguages: z.array(z.string()),
      version: z.number().int(),
      user: z.object({ displayName: z.string() }),
    }),
  ),
  holds: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      until: DateTimeSchema.nullable(),
      isPin: z.boolean(),
    }),
  ),
  retention: z.array(
    z.object({
      id: z.string(),
      state: z.string(),
      graceUntil: DateTimeSchema.nullable(),
      purgeAfter: DateTimeSchema.nullable(),
      version: z.number().int(),
    }),
  ),
  watchStates: z.array(
    z.object({
      userId: z.string(),
      watched: z.boolean(),
      observedAt: DateTimeSchema,
    }),
  ),
  assets: z.array(
    z.object({
      current: z.boolean(),
      edition: z.string(),
      asset: z.object({
        id: z.string(),
        properties: z.json(),
        state: z.string(),
        createdAt: DateTimeSchema,
        subtitles: z.array(
          z.object({
            id: z.string(),
            language: z.string(),
            providerId: z.string(),
            state: z.string(),
          }),
        ),
      }),
    }),
  ),
  events: z.array(
    z.object({ id: z.string(), kind: z.string(), createdAt: DateTimeSchema }),
  ),
});
export const CatalogItemSchema = z.object({
  externalId: z.number().int(),
  kind: z.enum(["movie", "series"]),
  title: z.string(),
  overview: z.string(),
  date: z.string(),
  posterPath: z.string().nullable(),
  originalLanguage: z.string(),
});
export const CatalogSearchSchema = z.object({
  page: z.number().int(),
  totalPages: z.number().int(),
  results: z.array(CatalogItemSchema),
});
export const CatalogDetailSchema = CatalogItemSchema.extend({
  seasons: z.array(
    z.object({
      externalId: z.number().int(),
      seasonNumber: z.number().int(),
      episodeCount: z.number().int(),
      title: z.string(),
    }),
  ),
});

export type CommandResult = z.output<typeof CommandResultSchema>;
export type RequestList = z.output<typeof RequestListSchema>;
export type OperationList = z.output<typeof OperationListSchema>;
export type RemovalList = z.output<typeof RemovalListSchema>;
export type NotificationList = z.output<typeof NotificationListSchema>;
export type ProfileList = z.output<typeof ProfileListSchema>;
export type UserList = z.output<typeof UserListSchema>;
export type MediaDetail = z.output<typeof MediaDetailSchema>;
export type CatalogSearch = z.output<typeof CatalogSearchSchema>;
export type CatalogDetail = z.output<typeof CatalogDetailSchema>;

export const NotificationPreferencesSchema = z.object({
  email: z.email().nullable(),
  emailVerified: z.boolean(),
  discordLinked: z.boolean(),
  discordAvailable: z.boolean(),
  emailEnabled: z.boolean(),
  discordEnabled: z.boolean(),
  upgrades: z.boolean(),
  removalCompleted: z.boolean(),
  version: z.number().int(),
});
export const UpdateNotificationPreferencesSchema = z
  .object({
    emailEnabled: z.boolean(),
    discordEnabled: z.boolean(),
    upgrades: z.boolean(),
    removalCompleted: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export const PublicReleaseAttributesSchema = z.object({
  mediaIds: z.array(z.string()),
  identityConfidence: z.enum(["exact", "ambiguous", "mismatch"]),
  quality: z.string(),
  codec: z.string(),
  audioLanguages: z.array(z.string()),
  sizeBytes: z.number().int().nonnegative(),
  scoreTags: z.array(z.string()),
  resolvedEvidence: ResolvedEvidenceSchema.optional(),
});
export const PublicReleaseEvaluationSchema = z.object({
  accepted: z.boolean(),
  qualityRank: z.number().int(),
  score: z.number(),
  reasons: z.array(
    z.union([
      z.string().regex(/^resolved_[a-z0-9_.:-]{1,150}$/u),
      z.enum([
        "identity_unconfirmed",
        "coverage_unspecified",
        "incomplete_coverage",
        "quality_rejected",
        "codec_rejected",
        "audio_language_missing",
        "size_unknown",
        "size_rejected",
        "score_below_minimum",
      ]),
    ]),
  ),
});
export const ReleaseListSchema = z.array(
  z.object({
    id: z.string(),
    providerId: z.string(),
    title: z.string(),
    attributes: PublicReleaseAttributesSchema,
    evaluation: PublicReleaseEvaluationSchema,
    createdAt: DateTimeSchema,
  }),
);
export const QualityRulesSchema = z
  .object({
    qualities: z.array(z.string().min(1)).min(1),
    rejectedCodecs: z.array(z.string()),
    requiredAudioLanguages: z.array(z.string()),
    minimumBytes: z.number().int().nonnegative(),
    maximumBytes: z.number().int().positive(),
    minimumScore: z.number(),
    tagScores: z.record(z.string(), z.number()),
    cutoffQuality: z.string(),
    cutoffScore: z.number(),
    resolved: ResolvedProfileSchema.optional(),
  })
  .strict()
  .refine(
    (rules) =>
      rules.minimumBytes <= rules.maximumBytes &&
      new Set(rules.qualities).size === rules.qualities.length &&
      rules.qualities.includes(rules.cutoffQuality),
    "Invalid size range, quality order, or cutoff",
  );
export const SaveQualityProfileSchema = z
  .object({
    id: z.string().optional(),
    expectedVersion: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(100),
    rules: QualityRulesSchema,
  })
  .strict();
export type NotificationPreferences = z.output<
  typeof NotificationPreferencesSchema
>;
export type UpdateNotificationPreferences = z.output<
  typeof UpdateNotificationPreferencesSchema
>;
export type ReleaseList = z.output<typeof ReleaseListSchema>;
export type SaveQualityProfile = z.output<typeof SaveQualityProfileSchema>;
export const ProfileDefaultsSchema = z.array(
  z.object({
    kind: z.enum(["movie", "series"]),
    profileId: z.string().min(1),
    version: z.number().int().nonnegative(),
  }),
);
export type ProfileDefaults = z.output<typeof ProfileDefaultsSchema>;
