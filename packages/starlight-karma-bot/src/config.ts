import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { createObservabilityHooks } from "@shepherdjerred/config/observability.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { prepareDefinition } from "@shepherdjerred/config/definition.ts";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";
import { featureFlagMetrics } from "#src/metrics.ts";

/**
 * Dynamic configuration — the values an operator can change without a deploy.
 *
 * Bootstrap values stay in `configuration.ts`: they are env-only by definition
 * and are read synchronously before anything async can run. `Sentry.init` and
 * the health server both need theirs before the flag client could possibly
 * exist, so routing them through an async resolver would invert startup order
 * for no benefit. That split IS the repo's policy — env for credentials and
 * bootstrap, flags for everything else.
 *
 * Both keys here are declared `targeted`, so change-detection caches per guild.
 * With one guild today that is a shape demonstration rather than a live need,
 * but getting it wrong later is a silent noise problem: keyed on the config key
 * alone, two guilds with different values would log a "change" on every
 * alternation.
 */
const DEFINITION = {
  /** Discord user ID allowed to configure recaps without Manage Server. */
  karmaAdminUserId: {
    schema: z.string(),
    sources: ["flag", "env", "default"],
    default: "",
    targeted: true,
  },
  /**
   * Emoji that awards karma. A unicode character matches by name; a custom
   * guild emoji matches by its snowflake id.
   */
  karmaEmoji: {
    schema: z.string().min(1),
    sources: ["flag", "env", "default"],
    default: "⭐",
    targeted: true,
  },
} as const;

export const DYNAMIC_FLAG_NAMES = Object.entries(DEFINITION).map(
  ([key, definition]) => prepareDefinition(key, definition).names.flag,
);

let resolver: ReturnType<typeof buildResolver> | undefined;

function buildResolver(
  flagSource: ConfigSource | undefined,
  environment: Readonly<Record<string, string | undefined>>,
) {
  return defineConfig({
    definition: DEFINITION,
    sources: {
      ...(flagSource === undefined ? {} : { flag: flagSource }),
      env: createEnvSource(environment),
    },
    hooks: createObservabilityHooks({
      // No metrics recorder: this service runs no Prometheus registry. The
      // hooks are optional precisely so a small bot does not have to grow one.
      log: (message) => {
        console.warn(`[Config] ${message}`);
      },
    }),
  });
}

export type InitializeConfigOptions = {
  /** Defaults to `Bun.env`. Tests pass an explicit environment. */
  readonly environment?: InitFeatureFlagsOptions["environment"];
  /** Overrides the flag provider. Tests use a static one. */
  readonly provider?: InitFeatureFlagsOptions["provider"];
};

/**
 * Starts the flag client and builds the resolver.
 *
 * A flag backend that is unreachable is NOT fatal: `initFeatureFlags` reports
 * the failure and every key then falls through to env and its default, which
 * are current production behavior. The bot boots either way.
 */
export async function initializeConfig(
  options: InitializeConfigOptions = {},
): Promise<void> {
  await initFeatureFlags({
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    metrics: featureFlagMetrics,
    onInitializationFailure: (message) => {
      console.warn(`[Config] ${message}`);
    },
  });
  const flagSource = createFlagConfigSource({
    // Per-guild targeting is supplied per read; this is the process-level
    // identity used when a call site has no guild in scope.
    targetingKey: "starlight-karma-bot",
    kinds: { karmaAdminUserId: "string", karmaEmoji: "string" },
  });
  resolver = buildResolver(flagSource, options.environment ?? Bun.env);
}

function getResolver(): ReturnType<typeof buildResolver> {
  if (resolver === undefined) {
    // Falling back to an env-only resolver would silently drop the flag layer
    // and look identical to a working setup, so this fails loudly instead.
    throw new Error(
      "dynamic config read before initializeConfig(); call it during startup",
    );
  }
  return resolver;
}

export async function karmaEmoji(guildId: string | null): Promise<string> {
  return getResolver().value("karmaEmoji", {
    targetingKey: guildId ?? "starlight-karma-bot",
  });
}

export async function karmaAdminUserId(
  guildId: string | null,
): Promise<string> {
  return getResolver().value("karmaAdminUserId", {
    targetingKey: guildId ?? "starlight-karma-bot",
  });
}

/** Every dynamic key with its value and the layer that supplied it. */
export async function describeDynamicConfig() {
  return getResolver().describe();
}

export async function shutdownConfig(): Promise<void> {
  resolver = undefined;
  await shutdownFeatureFlags();
}
