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
export const FeatureFlagModeSchema = z.enum(["flags", "static", "disabled"]);

export type FeatureFlagMode = z.infer<typeof FeatureFlagModeSchema>;

export type ParsedFlagsDeployment = {
  readonly catalog: string;
  readonly stage: string;
};

export function validateFlagsUrl(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "FLAGS_URL must be a valid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "FLAGS_URL must use http: or https:";
  }
  const hasCredentials =
    parsed.username !== "" ||
    parsed.password !== "" ||
    /^https?:\/\/[^/?#]*@/iu.test(value);
  return hasCredentials
    ? "FLAGS_URL must not embed credentials; snapshot reads are credentialless"
    : undefined;
}

export function parseFlagsDeployment(
  deployment: string,
): ParsedFlagsDeployment | undefined {
  const parts = deployment.split("/");
  if (parts.length !== 2) return undefined;
  const [catalog, stage] = parts;
  if (catalog === undefined || stage === undefined) return undefined;
  const invalidSegment =
    catalog === "." ||
    catalog === ".." ||
    stage === "." ||
    stage === ".." ||
    catalog.length === 0 ||
    stage.length === 0 ||
    /\s/u.test(deployment);
  return invalidSegment ? undefined : { catalog, stage };
}

export const FlagsUrlSchema = z.url().superRefine((value, context) => {
  const problem = validateFlagsUrl(value);
  if (problem !== undefined) {
    context.addIssue({ code: "custom", message: problem });
  }
});

export const FlagsDeploymentSchema = z
  .string()
  .refine(
    (value) => parseFlagsDeployment(value) !== undefined,
    'FLAGS_DEPLOYMENT must be "<catalog>/<stage>" with non-empty catalog and stage',
  );

export const FlagsConfigurationSchema = z.object({
  mode: z.literal("flags"),
  url: FlagsUrlSchema,
  deployment: FlagsDeploymentSchema,
  pollIntervalSeconds: z.number().int().positive(),
});

export type FlagsConfiguration = z.infer<typeof FlagsConfigurationSchema>;

export const StaticConfigurationSchema = z.object({
  mode: z.literal("static"),
  /** Key → value. Used by tests and by local development without a Flags server. */
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
  FlagsConfigurationSchema,
  StaticConfigurationSchema,
  DisabledConfigurationSchema,
]);

export type FeatureFlagConfiguration = z.infer<
  typeof FeatureFlagConfigurationSchema
>;
