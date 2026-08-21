import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { createConfigSnapshot } from "@shepherdjerred/config/snapshot.ts";
import { createObservabilityHooks } from "@shepherdjerred/config/observability.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";

/**
 * streambot's dynamically configurable values.
 *
 * ## What is deliberately NOT here
 *
 * `VOICE_ASSISTANT_ENABLED` and `VOICE_CAPTURE_ENABLED` stay in env, on
 * purpose:
 *
 * - Enabling voice today triggers *fatal* asset and model verification at
 *   startup. "Fatal" is not available at runtime, so making it a flag needs a
 *   designed degraded path — refuse to arm voice, log loudly, count an error —
 *   which is a behavior change, not a rewiring. It deserves its own change.
 * - `VOICE_CAPTURE_ENABLED` decides whether human audio is persisted to S3.
 *   Flipt runs without authentication, so moving it would let any tailnet
 *   device turn on recording. That is the sharpest instance of the accepted
 *   auth trade-off and should be a deliberate decision, not a side effect of a
 *   migration commit.
 *
 * Encoder settings are also absent, and would be misleading if present: ffmpeg
 * arguments are fixed for the process's lifetime, so flipping one changes
 * nothing until the stream restarts.
 *
 * ## What is here
 *
 * Two toggles the package's own docs describe as live-safe. Both are read
 * through a seeded snapshot because their call sites are synchronous, and both
 * fall back to the passed-in `Config` value until startup initializes the
 * snapshot — so this is a no-op until a flag exists.
 */
const DEFINITION = {
  playerCardEnabled: {
    schema: z.coerce.boolean(),
    sources: ["flag", "env", "default"],
    default: true,
    names: { env: "PLAYER_CARD_ENABLED" },
  },
  subtitlesEnabled: {
    schema: z.coerce.boolean(),
    sources: ["flag", "env", "default"],
    default: false,
    names: { env: "SUBTITLES_ENABLED" },
  },
} as const;

const REFRESH_INTERVAL_MS = 60_000;

type Snapshot = ReturnType<typeof buildSnapshot>;

function buildSnapshot(
  environment: Readonly<Record<string, string | undefined>>,
  seed: { playerCardEnabled: boolean; subtitlesEnabled: boolean },
  log: (message: string) => void,
) {
  const resolver = defineConfig({
    definition: DEFINITION,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "streambot",
        kinds: { playerCardEnabled: "boolean", subtitlesEnabled: "boolean" },
      }),
      env: createEnvSource(environment),
    },
    hooks: createObservabilityHooks({ log }),
  });
  return createConfigSnapshot({
    resolver,
    seed,
    onRefreshError: (key, message) => {
      log(`config refresh failed for ${key}; keeping last value: ${message}`);
    },
  });
}

let snapshot: Snapshot | undefined;

export type InitializeDynamicConfigOptions = {
  readonly environment?: InitFeatureFlagsOptions["environment"];
  readonly provider?: InitFeatureFlagsOptions["provider"];
  readonly seed: { playerCardEnabled: boolean; subtitlesEnabled: boolean };
  readonly log?: (message: string) => void;
  /** Tests pass false to avoid an interval. */
  readonly startPolling?: boolean;
};

export async function initializeDynamicConfig(
  options: InitializeDynamicConfigOptions,
): Promise<void> {
  // A no-op sink keeps every call site unconditional; streambot supplies its
  // own logger from the entry point.
  const log =
    options.log ??
    (() => {
      /* discard */
    });
  await initFeatureFlags({
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    onInitializationFailure: log,
  });
  snapshot = buildSnapshot(options.environment ?? Bun.env, options.seed, log);
  await snapshot.refresh();
  if (options.startPolling !== false) {
    snapshot.start(REFRESH_INTERVAL_MS);
  }
}

/**
 * Reads the dynamic value, or returns the caller's current one.
 *
 * Both accessors take the value the call site already had. Before startup
 * initializes the snapshot they return it unchanged, so behavior is identical
 * to before this module existed — there is no window where a toggle flips
 * because config was not ready yet.
 */
export function playerCardEnabled(fallback: boolean): boolean {
  return snapshot === undefined ? fallback : snapshot.get("playerCardEnabled");
}

export function subtitlesEnabled(fallback: boolean): boolean {
  return snapshot === undefined ? fallback : snapshot.get("subtitlesEnabled");
}

export function isDynamicConfigReady(): boolean {
  return snapshot !== undefined;
}

export async function shutdownDynamicConfig(): Promise<void> {
  snapshot?.stop();
  snapshot = undefined;
  await shutdownFeatureFlags();
}
