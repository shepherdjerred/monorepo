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

const TARGETING_KEY = "alert-dashboard";

const DEFINITION = {
  alertEmailEnabled: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: false,
    names: { flag: "alert-dashboard-email-enabled" },
  },
  alertEmailFrom: {
    schema: z.email(),
    sources: ["flag", "default"],
    default: "alerts@sjer.red",
    names: { flag: "alert-dashboard-email-from" },
  },
  alertEmailTo: {
    schema: z.email(),
    sources: ["flag", "default"],
    default: "dependencies@sjer.red",
    names: { flag: "alert-dashboard-email-to" },
  },
} as const;

function createResolver() {
  return defineConfig({
    definition: DEFINITION,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: TARGETING_KEY,
        kinds: {
          alertEmailEnabled: "boolean",
          alertEmailFrom: "string",
          alertEmailTo: "string",
        },
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

/** Incident mail is constructed at startup; changes require a restart. */
export async function alertEmailConfig() {
  const resolver = createResolver();
  const [enabled, from, to] = await Promise.all([
    resolver.value("alertEmailEnabled"),
    resolver.value("alertEmailFrom"),
    resolver.value("alertEmailTo"),
  ]);
  return {
    EMAIL_ENABLED: String(enabled),
    POSTAL_FROM: from,
    POSTAL_TO: to,
  };
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
 * Initialize the process-wide flag client (one per process).
 * `FEATURE_FLAGS_MODE`, `FLIPT_URL`, `FLIPT_NAMESPACE`, and
 * `FLIPT_ENVIRONMENT` are bootstrap variables read by the flags package.
 */
export async function initFeatureFlagClient(options: {
  environment: InitFeatureFlagsOptions["environment"];
  metrics: FlagMetricsRecorder;
}): Promise<{ shutdown: () => Promise<void> }> {
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
  return { shutdown: () => shutdownFeatureFlags() };
}
