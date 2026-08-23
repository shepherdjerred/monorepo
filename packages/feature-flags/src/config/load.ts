import { z } from "zod";
import {
  FeatureFlagConfigurationSchema,
  FeatureFlagModeSchema,
  type FeatureFlagConfiguration,
} from "@shepherdjerred/feature-flags/config/schema.ts";

export type Environment = Readonly<Record<string, string | undefined>>;

const DEFAULT_POLL_INTERVAL_SECONDS = 300;

const PollIntervalSchema = z.coerce.number().int().positive();

const StaticOverridesSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.string(), z.number()]),
);

function requireVariable(environment: Environment, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${name} is required when FEATURE_FLAGS_MODE=flipt. Set it, or set FEATURE_FLAGS_MODE=disabled.`,
    );
  }
  return value;
}

/**
 * Pure: takes an environment rather than reading `Bun.env`, so tests never
 * mutate process state. Throws on malformed configuration — that is a deploy
 * bug, distinct from a flag backend being unreachable, which never throws.
 */
export function loadFeatureFlagConfiguration(
  environment: Environment,
): FeatureFlagConfiguration {
  const rawMode = environment["FEATURE_FLAGS_MODE"];
  if (rawMode === undefined || rawMode.length === 0) {
    throw new Error(
      "FEATURE_FLAGS_MODE is required (flipt | static | disabled). It has no default on purpose: a service that silently served call-site defaults would look healthy while ignoring every flag.",
    );
  }
  const mode = FeatureFlagModeSchema.parse(rawMode);

  if (mode === "disabled") {
    return FeatureFlagConfigurationSchema.parse({ mode });
  }

  if (mode === "static") {
    const raw = environment["FEATURE_FLAGS_STATIC_OVERRIDES"] ?? "{}";
    const parsed: unknown = JSON.parse(raw);
    return FeatureFlagConfigurationSchema.parse({
      mode,
      overrides: StaticOverridesSchema.parse(parsed),
    });
  }

  const rawPoll = environment["FLIPT_POLL_INTERVAL_SECONDS"];
  return FeatureFlagConfigurationSchema.parse({
    mode,
    url: requireVariable(environment, "FLIPT_URL"),
    namespace: environment["FLIPT_NAMESPACE"] ?? "default",
    environment: environment["FLIPT_ENVIRONMENT"] ?? "default",
    pollIntervalSeconds:
      rawPoll === undefined || rawPoll.length === 0
        ? DEFAULT_POLL_INTERVAL_SECONDS
        : PollIntervalSchema.parse(rawPoll),
  });
}
