import { z } from "zod";
import { AvailabilitySchema, VersionSchema } from "#shared/contract.ts";
import {
  MovieEditionContextV3Schema,
  MovieEditionRequestViewSchema,
} from "#shared/movie-editions/view.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { MovieEditionReasonSchema } from "#shared/movie-editions/fulfillment.ts";
import { MediaVisibilitySchema } from "#shared/visibility/detail.ts";
import { SubtitlePolicySatisfactionSchema } from "#shared/subtitle-policy.ts";
import {
  MovieTargetExpectedV4Schema,
  MovieRemovalConfirmationV4Schema,
  MovieRequestResultV4Schema,
} from "./lifecycle-v4.ts";

export const MovieAdmissionReasonV4Schema = z.enum([
  ...MovieEditionReasonSchema.options,
  "runtime_protected",
  "quality_profile_required",
  "recovery_hold",
  "acquisition_active",
  "request_inactive",
  "choice_activation_required",
  "asset_unavailable",
  "native_operation_unsettled",
]);
export const MovieEditionContextV4Schema = MovieEditionContextV3Schema.extend({
  schemaVersion: z.literal(4),
  options: z
    .array(
      MovieEditionContextV3Schema.shape.options.element.extend({
        reasons: z.array(MovieAdmissionReasonV4Schema),
        activationRequired: z.boolean(),
      }),
    )
    .length(7)
    .refine(
      (options) => new Set(options.map((option) => option.edition)).size === 7,
      "Edition options must remain unique",
    ),
});

const Activation = { activationRequired: z.boolean() };
export const MovieEditionRequestViewV4Schema = z.discriminatedUnion("access", [
  MovieEditionRequestViewSchema.options[0].extend(Activation),
  MovieEditionRequestViewSchema.options[1].extend(Activation),
]);
export const MovieEditionRequestListV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  subjectUserId: z.uuid(),
  items: z.array(MovieEditionRequestViewV4Schema).max(50),
  nextCursor: z.uuid().nullable(),
});

/** Activation references a real current immutable choice. It never chooses or rewrites that choice. */
export const ActivateMovieEditionChoiceV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  scope: MovieEditionScopeSchema,
  subjectUserId: z.uuid(),
  requestId: z.uuid(),
  choiceId: z.uuid(),
  expected: MovieTargetExpectedV4Schema.extend({
    requestVersion: VersionSchema,
    choiceRevision: VersionSchema,
  }),
});
export const ActivateMovieEditionChoiceResultV4Schema =
  MovieRequestResultV4Schema.extend({
    state: z.literal("queued"),
    reason: z.null(),
  });

export const MovieProtectiveActionV4Schema = z.enum([
  "keep",
  "pin",
  "unpin",
  "cancel_request",
  "revoke_choice",
]);
export const MovieLifecycleActionNameV4Schema = z.enum([
  "keep",
  "pin",
  "unpin",
  "restore",
  "remove",
  "retry",
  "select_release",
]);
export const MovieTargetAssetV4Schema = z.strictObject({
  id: z.uuid(),
  version: VersionSchema,
  state: z.string().min(1),
  properties: z.strictObject({
    quality: z.string().optional(),
    codec: z.string().optional(),
    sizeBytes: z.number().nonnegative().optional(),
    audioLanguages: z.array(z.string()).optional(),
    hdr: z.boolean().optional(),
  }),
  captions: z
    .array(
      z.strictObject({
        id: z.uuid(),
        language: z.string().min(1),
        state: z.enum(["installed", "quarantined"]),
        qualityStatus: z.string(),
        storageKind: z.string(),
        accepted: z.boolean(),
        forced: z.boolean().nullable(),
        hearingImpaired: z.boolean().nullable(),
      }),
    )
    .max(100),
  captionsTruncated: z.boolean(),
  subtitleStatus: SubtitlePolicySatisfactionSchema.nullable().default(null),
});
export const MovieTargetProgressV4Schema = MediaVisibilitySchema.pick({
  attempts: true,
  torrents: true,
  historyTruncated: true,
});
const CommonTarget = {
  schemaVersion: z.literal(4),
  scope: MovieEditionScopeSchema,
  expected: MovieTargetExpectedV4Schema,
  ownRequests: z
    .array(
      z.strictObject({
        id: z.uuid(),
        version: VersionSchema,
        active: z.boolean(),
        choiceId: z.uuid().nullable(),
        choiceRevision: VersionSchema,
        canCancel: z.boolean(),
        canRevokeChoice: z.boolean(),
      }),
    )
    .max(100),
  ownHold: z
    .strictObject({ isPin: z.boolean(), until: z.iso.datetime().nullable() })
    .nullable(),
  allowedProtectiveActions: z.array(MovieProtectiveActionV4Schema),
};
export const MovieTargetContextV4Schema = z.discriminatedUnion("access", [
  z.strictObject({
    ...CommonTarget,
    access: z.literal("detail"),
    title: z.string().min(1),
    year: z.int().nullable(),
    editionLabel: z.string().min(1),
    target: z.strictObject({
      generation: VersionSchema,
      availability: AvailabilitySchema,
      desiredPresence: z.boolean(),
      monitoring: z.boolean(),
      libraryMonitoring: z.boolean(),
    }),
    allowedActions: z.array(MovieLifecycleActionNameV4Schema),
    reasons: z.array(MovieAdmissionReasonV4Schema),
    removalConfirmation: MovieRemovalConfirmationV4Schema.nullable(),
    currentAsset: MovieTargetAssetV4Schema.nullable(),
    progress: MovieTargetProgressV4Schema.nullable(),
  }),
  z.strictObject({ ...CommonTarget, access: z.literal("protection_only") }),
]);

export type MovieEditionContextV4 = z.infer<typeof MovieEditionContextV4Schema>;
export type MovieEditionRequestListV4 = z.infer<
  typeof MovieEditionRequestListV4Schema
>;
export type MovieTargetContextV4 = z.infer<typeof MovieTargetContextV4Schema>;
export type ActivateMovieEditionChoiceV4 = z.infer<
  typeof ActivateMovieEditionChoiceV4Schema
>;
export type ActivateMovieEditionChoiceResultV4 = z.infer<
  typeof ActivateMovieEditionChoiceResultV4Schema
>;
