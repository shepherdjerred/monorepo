import { z } from "zod";

/**
 * How the flag client sources values.
 *
 * There is deliberately no Zod `.default()` on the mode. A pod that forgets to
 * set it should crash at startup rather than quietly serving call-site defaults
 * forever while looking healthy — an all-defaults service is indistinguishable
 * from a working one until someone flips a flag and nothing happens.
 *
 * For the same reason there is no `NODE_ENV` sniffing: a hidden environment
 * fork is exactly the silent fallback this repo bans. Test and dev environments
 * set `FEATURE_FLAGS_MODE=disabled` explicitly.
 */
export const FeatureFlagModeSchema = z.enum(["flipt", "static", "disabled"]);

export type FeatureFlagMode = z.infer<typeof FeatureFlagModeSchema>;

export const FliptConfigurationSchema = z.object({
  mode: z.literal("flipt"),
  url: z.url(),
  namespace: z.string().min(1),
  environment: z.string().min(1),
  pollIntervalSeconds: z.number().int().positive(),
});

export type FliptConfiguration = z.infer<typeof FliptConfigurationSchema>;

export const StaticConfigurationSchema = z.object({
  mode: z.literal("static"),
  /** Key → value. Used by tests and by local development without a Flipt. */
  overrides: z.record(
    z.string(),
    z.union([z.boolean(), z.string(), z.number()]),
  ),
});

export type StaticConfiguration = z.infer<typeof StaticConfigurationSchema>;

export const DisabledConfigurationSchema = z.object({
  mode: z.literal("disabled"),
});

export type DisabledConfiguration = z.infer<typeof DisabledConfigurationSchema>;

export const FeatureFlagConfigurationSchema = z.discriminatedUnion("mode", [
  FliptConfigurationSchema,
  StaticConfigurationSchema,
  DisabledConfigurationSchema,
]);

export type FeatureFlagConfiguration = z.infer<
  typeof FeatureFlagConfigurationSchema
>;
