import { z } from "zod";
import { DateTimeSchema } from "./api.ts";

export const TrackerProviderIdSchema = z.enum([
  "knaben",
  "thepiratebay",
  "magnetdownload",
  "privatehd",
  "avistaz",
  "animez",
]);
export const SubtitleProviderIdSchema = z.enum([
  "opensubtitles",
  "assrt",
  "subhd",
  "zimuku",
]);
export const AdminProviderIdSchema = z.enum([
  ...TrackerProviderIdSchema.options,
  ...SubtitleProviderIdSchema.options,
]);
export type AdminProviderId = z.infer<typeof AdminProviderIdSchema>;
export const ProviderConfigurationSchema = z
  .object({
    minimumIntervalSeconds: z.number().int().min(1).max(3600),
    dailyDownloadLimit: z.number().int().min(1).max(1000),
  })
  .strict();
const PrivatePolicyProof = {
  verified: z.boolean(),
  evidence: z.string().trim().min(10).max(2000),
};
export const ProviderSeedingPolicySchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("unknown") }).strict(),
    z.object({ kind: z.literal("public") }).strict(),
    z
      .object({
        kind: z.literal("privatehd"),
        ...PrivatePolicyProof,
        ratio: z.number().positive().nullable(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("private"),
        ...PrivatePolicyProof,
        ratio: z.number().positive().nullable(),
        minimumSeconds: z.number().int().positive().nullable(),
        combination: z.enum(["all", "any"]),
        sizeRule: z
          .object({
            secondsPerGiB: z.number().positive(),
            minimumSeconds: z.number().int().nonnegative(),
            maximumSeconds: z.number().int().positive().nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  ])
  .superRefine((policy, context) => {
    if (policy.kind !== "private") return;
    if (
      policy.sizeRule !== null &&
      policy.sizeRule.maximumSeconds !== null &&
      policy.sizeRule.maximumSeconds < policy.sizeRule.minimumSeconds
    )
      context.addIssue({
        code: "custom",
        message: "Maximum size-rule duration must not be below its minimum",
        path: ["sizeRule", "maximumSeconds"],
      });
    if (
      policy.verified &&
      policy.ratio === null &&
      policy.minimumSeconds === null &&
      policy.sizeRule === null
    )
      context.addIssue({
        code: "custom",
        message: "A verified private policy needs at least one obligation",
      });
  });
export const SaveProviderSchema = z
  .object({
    expectedUpdatedAt: z.iso.datetime().nullable(),
    enabled: z.boolean(),
    configuration: ProviderConfigurationSchema,
    seedingPolicy: ProviderSeedingPolicySchema,
    /** Absent preserves the existing credential; null removes it. Never returned by reads. */
    credential: z
      .record(z.string(), z.string().max(16_384))
      .nullable()
      .optional(),
  })
  .strict();
export const ProviderStatusSchema = z.object({
  id: AdminProviderIdSchema,
  kind: z.enum(["tracker", "subtitle"]),
  enabled: z.boolean(),
  configured: z.boolean(),
  credentialConfigured: z.boolean(),
  configuration: ProviderConfigurationSchema,
  seedingPolicy: ProviderSeedingPolicySchema,
  updatedAt: DateTimeSchema.nullable(),
  lastError: z
    .enum([
      "authentication",
      "rate-limited",
      "unavailable",
      "invalid-response",
      "outcome-unknown",
      "interaction-required",
      "conflict",
    ])
    .nullable(),
  nextAllowedAt: DateTimeSchema.nullable(),
  feedState: z.enum(["unconfigured", "unsupported_recent_feed"]),
  lastFeedAt: DateTimeSchema.nullable(),
});
export const ProviderListSchema = z.array(ProviderStatusSchema);
export type ProviderStatus = z.output<typeof ProviderStatusSchema>;
export type SaveProvider = z.infer<typeof SaveProviderSchema>;

export const MAX_MANUAL_SUBTITLE_BYTES = 8 * 1024 * 1024;
export const ManualSubtitleSchema = z
  .object({
    assetId: z.uuid(),
    expectedAssetVersion: z.number().int().nonnegative(),
    expectedChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
    language: z.enum(["en", "zh-Hans"]),
    forced: z.boolean().optional(),
    hearingImpaired: z.boolean().optional(),
    filename: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\\0]+\.(?:srt|ass|ssa|vtt)$/iu),
    description: z.string().trim().min(1).max(2000),
    contentBase64: z.base64().max(Math.ceil(MAX_MANUAL_SUBTITLE_BYTES / 3) * 4),
    declaredEncoding: z
      .enum(["utf8", "utf-16le", "utf-16be", "gb18030"])
      .optional(),
    confirmedMatchingVideo: z.literal(true),
    replacementFor: z
      .strictObject({
        oldSubtitleId: z.uuid(),
        expectedOldVersion: z.int().nonnegative(),
      })
      .optional(),
  })
  .strict();
export const SubtitleTargetListSchema = z.array(
  z.object({
    assetId: z.uuid(),
    version: z.number().int(),
    checksum: z.string(),
    filename: z.string(),
    titles: z.array(z.string()),
    installedLanguages: z.array(z.string()),
    subtitles: z
      .array(
        z.strictObject({
          id: z.uuid(),
          version: z.int().nonnegative(),
          state: z.enum(["validated", "installed"]),
          qualityStatus: z.enum(["accepted", "unverified", "rejected"]),
          language: z.string(),
          forced: z.boolean().nullable(),
          hearingImpaired: z.boolean().nullable(),
          providerId: z.string(),
          filename: z.string().nullable(),
          storageKind: z.string(),
        }),
      )
      .max(200),
  }),
);
export type ManualSubtitle = z.infer<typeof ManualSubtitleSchema>;
export type SubtitleTarget = z.infer<typeof SubtitleTargetListSchema>[number];
