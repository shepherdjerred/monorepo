import { defineConfig } from "@shepherdjerred/config";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  createFlagMetricsRecorder,
  type FlagMetricsRecorder,
} from "@shepherdjerred/feature-flags/observability.ts";
import { z } from "zod";

import type { DigestGatePort } from "#application/ports";

const TARGETING_KEY = "alert-dashboard";

const DEFINITION = {
  opsDigestEmailEnabled: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: false,
    names: { flag: "ops-digest-email-enabled" },
  },
} as const;

function createResolver() {
  return defineConfig({
    definition: DEFINITION,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: TARGETING_KEY,
        kinds: { opsDigestEmailEnabled: "boolean" },
      }),
    },
    hooks: {
      onSourceError: (key, source, message) => {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "config_source_error",
            key,
            source,
            error: message,
          }),
        );
      },
    },
  });
}

export type FlagMetricSink = {
  countEvaluation: (flag: string, reason: string) => void;
  countError: (operation: string) => void;
  providerReady: (ready: boolean) => void;
  snapshotAge: (seconds: number) => void;
};

export function flagMetricsRecorder(sink: FlagMetricSink): FlagMetricsRecorder {
  return createFlagMetricsRecorder({
    evaluations: {
      inc: ({ flag, reason }) => {
        sink.countEvaluation(flag, reason);
      },
    },
    errors: {
      inc: ({ operation }) => {
        sink.countError(operation);
      },
    },
    providerReady: {
      set: (value) => {
        sink.providerReady(value === 1);
      },
    },
    snapshotAge: {
      set: (value) => {
        sink.snapshotAge(value);
      },
    },
  });
}

/**
 * Initialize the process-wide flag client (one per process) and return the
 * digest gate. `FEATURE_FLAGS_MODE`, `FLIPT_URL`, `FLIPT_NAMESPACE`, and
 * `FLIPT_ENVIRONMENT` are bootstrap variables read by the flags package.
 */
export async function createDigestGate(options: {
  environment: InitFeatureFlagsOptions["environment"];
  metrics: FlagMetricsRecorder;
}): Promise<DigestGatePort & { shutdown: () => Promise<void> }> {
  await initFeatureFlags({
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
    metrics: options.metrics,
    onInitializationFailure: (message) => {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "feature_flags_initialization_failed",
          error: message,
        }),
      );
    },
  });
  const resolver = createResolver();
  return {
    digestEmailEnabled: () =>
      resolver.value("opsDigestEmailEnabled", { targetingKey: TARGETING_KEY }),
    shutdown: () => shutdownFeatureFlags(),
  };
}
