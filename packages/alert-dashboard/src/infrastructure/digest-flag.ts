import { defineConfig } from "@shepherdjerred/config";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import {
  createFlagMetricsRecorder,
  type FlagMetricsRecorder,
} from "@shepherdjerred/feature-flags/observability.ts";
import { OPS_MAILBOXES } from "@shepherdjerred/ops-model/email/mailbox.ts";
import { z } from "zod";

const TARGETING_KEY = "alert-dashboard";

const DEFINITION = {
  alertEmailEnabled: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: managedBooleanDefault("alert-dashboard-email-enabled"),
    names: { flag: "alert-dashboard-email-enabled" },
  },
  dailyDigestQuietClear: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: managedBooleanDefault("alert-dashboard-daily-digest-quiet-clear"),
    names: { flag: "alert-dashboard-daily-digest-quiet-clear" },
  },
  incidentEmailFrom: {
    schema: flagValueSchema("alert-dashboard-incident-email-from"),
    sources: ["flag", "default"],
    default: OPS_MAILBOXES.alerts.from,
    names: { flag: "alert-dashboard-incident-email-from" },
  },
  incidentEmailTo: {
    schema: flagValueSchema("alert-dashboard-incident-email-to"),
    sources: ["flag", "default"],
    default: OPS_MAILBOXES.alerts.to,
    names: { flag: "alert-dashboard-incident-email-to" },
  },
  digestEmailFrom: {
    schema: flagValueSchema("alert-dashboard-digest-email-from"),
    sources: ["flag", "default"],
    default: OPS_MAILBOXES.digests.from,
    names: { flag: "alert-dashboard-digest-email-from" },
  },
  digestEmailTo: {
    schema: flagValueSchema("alert-dashboard-digest-email-to"),
    sources: ["flag", "default"],
    default: OPS_MAILBOXES.digests.to,
    names: { flag: "alert-dashboard-digest-email-to" },
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
          dailyDigestQuietClear: "boolean",
          incidentEmailFrom: flagValueKind(
            "alert-dashboard-incident-email-from",
          ),
          incidentEmailTo: flagValueKind("alert-dashboard-incident-email-to"),
          digestEmailFrom: flagValueKind("alert-dashboard-digest-email-from"),
          digestEmailTo: flagValueKind("alert-dashboard-digest-email-to"),
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

/** Incident and digest mail routing is constructed at startup; changes require a restart. */
export async function alertEmailConfig() {
  const resolver = createResolver();
  const [
    enabled,
    dailyDigestQuietClear,
    incidentFrom,
    incidentTo,
    digestFrom,
    digestTo,
  ] = await Promise.all([
    resolver.value("alertEmailEnabled"),
    resolver.value("dailyDigestQuietClear"),
    resolver.value("incidentEmailFrom"),
    resolver.value("incidentEmailTo"),
    resolver.value("digestEmailFrom"),
    resolver.value("digestEmailTo"),
  ]);
  return {
    EMAIL_ENABLED: String(enabled),
    DAILY_DIGEST_QUIET_CLEAR: String(dailyDigestQuietClear),
    MAIL_FROM: incidentFrom,
    MAIL_TO: incidentTo,
    MAIL_DIGEST_FROM: digestFrom,
    MAIL_DIGEST_TO: digestTo,
  };
}

export type FlagMetricSink = {
  countEvaluation: (flag: string, reason: string, value: string) => void;
  countError: (operation: string) => void;
  providerReady: (ready: boolean) => void;
  snapshotAge: (seconds: number) => void;
  providerInfo: (info: { deployment: string } | undefined) => void;
};

export function flagMetricsRecorder(sink: FlagMetricSink): FlagMetricsRecorder {
  return createFlagMetricsRecorder({
    evaluations: {
      inc: ({ flag, reason, value }) => {
        sink.countEvaluation(flag, reason, value);
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
    providerInfo: {
      reset: () => {
        sink.providerInfo(undefined);
      },
      set: (labels) => {
        sink.providerInfo(labels);
      },
    },
  });
}

/**
 * Initialize the process-wide flag client (one per process).
 * `FEATURE_FLAGS_MODE`, `FLAGS_URL`, and `FLAGS_DEPLOYMENT` are bootstrap
 * variables read by the flags package.
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
