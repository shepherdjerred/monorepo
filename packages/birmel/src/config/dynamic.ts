import { defineConfig } from "@shepherdjerred/config";
import { createConfigSnapshot } from "@shepherdjerred/config/snapshot.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
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
import { z } from "zod";
import { featureFlagMetrics } from "@shepherdjerred/birmel/observability/metrics.ts";
import { getConfig } from "./index.ts";
import type { Config } from "./schema.ts";

const DynamicBooleanSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const lowered = value.toLowerCase();
  return lowered === "true" || (lowered !== "false" && value);
}, z.boolean());

/**
 * Values that are safe to change while Birmel is serving requests. Scheduler
 * enablement and schedule shape remain boot-scoped until the scheduler has an
 * explicit pause/resume lifecycle.
 */
const DEFINITION = {
  dailyPostsEnabled: {
    schema: DynamicBooleanSchema,
    sources: ["flag", "env", "default"],
    default: true,
    names: { flag: "birmel-daily-posts-enabled", env: "DAILY_POSTS_ENABLED" },
  },
  personaEnabled: {
    schema: DynamicBooleanSchema,
    sources: ["flag", "env", "default"],
    default: true,
    names: { flag: "birmel-persona-enabled", env: "PERSONA_ENABLED" },
  },
  responderEnabled: {
    schema: DynamicBooleanSchema,
    sources: ["flag", "env", "default"],
    default: true,
    names: { flag: "birmel-responder-enabled", env: "RESPONDER_ENABLED" },
  },
  birthdaysEnabled: {
    schema: DynamicBooleanSchema,
    sources: ["flag", "env", "default"],
    default: true,
    names: { flag: "birmel-birthdays-enabled", env: "BIRTHDAYS_ENABLED" },
  },
  activityTrackingEnabled: {
    schema: DynamicBooleanSchema,
    sources: ["flag", "env", "default"],
    default: true,
    names: {
      flag: "birmel-activity-tracking-enabled",
      env: "ACTIVITY_TRACKING_ENABLED",
    },
  },
  electionsEnabled: {
    schema: DynamicBooleanSchema,
    sources: ["flag", "env", "default"],
    default: true,
    names: { flag: "birmel-elections-enabled", env: "ELECTIONS_ENABLED" },
  },
  llmModel: {
    schema: flagValueSchema("birmel-llm-model"),
    sources: ["flag", "env", "default"],
    default: "gpt-6.1-sol",
    names: { flag: "birmel-llm-model", env: "LLM_MODEL" },
  },
  classifierModel: {
    schema: flagValueSchema("birmel-llm-classifier-model"),
    sources: ["flag", "env", "default"],
    default: "gpt-6-luna",
    names: { flag: "birmel-llm-classifier-model", env: "LLM_CLASSIFIER_MODEL" },
  },
  decisionsEnabled: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: true,
    names: { flag: "birmel-llm-decisions-enabled" },
  },
  decisionsModel: {
    schema: flagValueSchema("birmel-llm-decisions-model"),
    sources: ["flag", "default"],
    default: "gpt-6-luna",
    names: { flag: "birmel-llm-decisions-model" },
  },
  decisionsThreshold: {
    schema: flagValueSchema("birmel-llm-decisions-threshold"),
    sources: ["flag", "default"],
    default: 0.5,
    names: { flag: "birmel-llm-decisions-threshold" },
  },
  memoryModel: {
    schema: flagValueSchema("birmel-llm-memory-model"),
    sources: ["flag", "env", "default"],
    default: "gpt-6-luna",
    names: { flag: "birmel-llm-memory-model", env: "LLM_MEMORY_MODEL" },
  },
  embeddingModel: {
    schema: flagValueSchema("birmel-llm-embedding-model"),
    sources: ["flag", "env", "default"],
    default: "text-embedding-3-small",
    names: { flag: "birmel-llm-embedding-model", env: "LLM_EMBEDDING_MODEL" },
  },
  imageModel: {
    schema: flagValueSchema("birmel-llm-image-model"),
    sources: ["flag", "env", "default"],
    default: "gemini-3-pro-image-preview",
    names: { flag: "birmel-llm-image-model", env: "LLM_IMAGE_MODEL" },
  },
  personaStyleModel: {
    schema: flagValueSchema("birmel-persona-style-model"),
    sources: ["flag", "env", "default"],
    default: "gpt-6-luna",
    names: { flag: "birmel-persona-style-model", env: "PERSONA_STYLE_MODEL" },
  },
  reasoningEffort: {
    schema: flagValueSchema("birmel-llm-reasoning-effort"),
    sources: ["flag", "env", "default"],
    default: "medium",
    names: { flag: "birmel-llm-reasoning-effort", env: "LLM_REASONING_EFFORT" },
  },
  maxTokens: {
    schema: flagValueSchema("birmel-llm-max-output-tokens"),
    sources: ["flag", "env", "default"],
    default: 4096,
    names: {
      flag: "birmel-llm-max-output-tokens",
      env: "LLM_MAX_OUTPUT_TOKENS",
    },
  },
  agentMaxSteps: {
    schema: flagValueSchema("birmel-agent-max-steps"),
    sources: ["flag", "env", "default"],
    default: 12,
    names: { flag: "birmel-agent-max-steps", env: "AGENT_MAX_STEPS" },
  },
  agentResponseTimeoutMs: {
    schema: flagValueSchema("birmel-agent-response-timeout-ms"),
    sources: ["flag", "env", "default"],
    default: 300_000,
    names: {
      flag: "birmel-agent-response-timeout-ms",
      env: "AGENT_RESPONSE_TIMEOUT_MS",
    },
  },
  agentAuxiliaryTimeoutMs: {
    schema: flagValueSchema("birmel-agent-auxiliary-timeout-ms"),
    sources: ["flag", "env", "default"],
    default: 30_000,
    names: {
      flag: "birmel-agent-auxiliary-timeout-ms",
      env: "AGENT_AUXILIARY_TIMEOUT_MS",
    },
  },
  responderEngagementWindowMs: {
    schema: flagValueSchema("birmel-responder-engagement-window-ms"),
    sources: ["flag", "env", "default"],
    default: 180_000,
    names: {
      flag: "birmel-responder-engagement-window-ms",
      env: "RESPONDER_ENGAGEMENT_WINDOW_MS",
    },
  },
  responderTranscriptWindowMs: {
    schema: flagValueSchema("birmel-responder-transcript-window-ms"),
    sources: ["flag", "env", "default"],
    default: 3_600_000,
    names: {
      flag: "birmel-responder-transcript-window-ms",
      env: "RESPONDER_TRANSCRIPT_WINDOW_MS",
    },
  },
  responderTranscriptMaxMessages: {
    schema: flagValueSchema("birmel-responder-transcript-max-messages"),
    sources: ["flag", "env", "default"],
    default: 50,
    names: {
      flag: "birmel-responder-transcript-max-messages",
      env: "RESPONDER_TRANSCRIPT_MAX_MESSAGES",
    },
  },
} as const;

type Snapshot = ReturnType<typeof createSnapshot>["snapshot"];

function createSnapshot(
  environment: Readonly<Record<string, string | undefined>>,
  config: Config,
  log: (message: string) => void,
) {
  const resolver = defineConfig({
    definition: DEFINITION,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "birmel",
        kinds: {
          dailyPostsEnabled: "boolean",
          personaEnabled: "boolean",
          responderEnabled: "boolean",
          birthdaysEnabled: "boolean",
          activityTrackingEnabled: "boolean",
          electionsEnabled: "boolean",
          llmModel: flagValueKind("birmel-llm-model"),
          classifierModel: flagValueKind("birmel-llm-classifier-model"),
          decisionsEnabled: "boolean",
          decisionsModel: flagValueKind("birmel-llm-decisions-model"),
          decisionsThreshold: flagValueKind("birmel-llm-decisions-threshold"),
          memoryModel: flagValueKind("birmel-llm-memory-model"),
          embeddingModel: flagValueKind("birmel-llm-embedding-model"),
          imageModel: flagValueKind("birmel-llm-image-model"),
          personaStyleModel: flagValueKind("birmel-persona-style-model"),
          reasoningEffort: flagValueKind("birmel-llm-reasoning-effort"),
          maxTokens: flagValueKind("birmel-llm-max-output-tokens"),
          agentMaxSteps: flagValueKind("birmel-agent-max-steps"),
          agentResponseTimeoutMs: flagValueKind(
            "birmel-agent-response-timeout-ms",
          ),
          agentAuxiliaryTimeoutMs: flagValueKind(
            "birmel-agent-auxiliary-timeout-ms",
          ),
          responderEngagementWindowMs: flagValueKind(
            "birmel-responder-engagement-window-ms",
          ),
          responderTranscriptWindowMs: flagValueKind(
            "birmel-responder-transcript-window-ms",
          ),
          responderTranscriptMaxMessages: flagValueKind(
            "birmel-responder-transcript-max-messages",
          ),
        },
      }),
      env: createEnvSource(environment),
    },
    hooks: {
      onSourceError: (key, source, message) => {
        log(`${key} ${source}: ${message}`);
      },
    },
  });
  const snapshot = createConfigSnapshot({
    resolver,
    seed: {
      dailyPostsEnabled: config.dailyPosts.enabled,
      personaEnabled: config.persona.enabled,
      responderEnabled: config.responder.enabled,
      birthdaysEnabled: config.birthdays.enabled,
      activityTrackingEnabled: config.activityTracking.enabled,
      electionsEnabled: config.elections.enabled,
      llmModel: config.llm.model,
      classifierModel: config.llm.classifierModel,
      decisionsEnabled: config.llm.decisionsEnabled,
      decisionsModel: config.llm.decisionsModel,
      decisionsThreshold: config.llm.decisionsThreshold,
      memoryModel: config.llm.memoryModel,
      embeddingModel: config.llm.embeddingModel,
      imageModel: config.llm.imageModel,
      personaStyleModel: config.persona.styleModel,
      reasoningEffort: config.llm.reasoningEffort,
      maxTokens: config.llm.maxTokens,
      agentMaxSteps: config.agent.maxSteps,
      agentResponseTimeoutMs: config.agent.responseTimeoutMs,
      agentAuxiliaryTimeoutMs: config.agent.auxiliaryTimeoutMs,
      responderEngagementWindowMs: config.responder.engagementWindowMs,
      responderTranscriptWindowMs: config.responder.transcriptWindowMs,
      responderTranscriptMaxMessages: config.responder.transcriptMaxMessages,
    },
    onRefreshError: (key, message) => {
      log(`config refresh failed for ${key}; keeping last value: ${message}`);
    },
  });
  return { snapshot, config };
}

function applySnapshot(snapshot: Snapshot, config: Config): void {
  config.dailyPosts.enabled = snapshot.get("dailyPostsEnabled");
  config.persona.enabled = snapshot.get("personaEnabled");
  config.responder.enabled = snapshot.get("responderEnabled");
  config.birthdays.enabled = snapshot.get("birthdaysEnabled");
  config.activityTracking.enabled = snapshot.get("activityTrackingEnabled");
  config.elections.enabled = snapshot.get("electionsEnabled");
  config.llm.model = snapshot.get("llmModel");
  config.llm.classifierModel = snapshot.get("classifierModel");
  config.llm.decisionsEnabled = snapshot.get("decisionsEnabled");
  config.llm.decisionsModel = snapshot.get("decisionsModel");
  config.llm.decisionsThreshold = snapshot.get("decisionsThreshold");
  config.llm.memoryModel = snapshot.get("memoryModel");
  config.llm.embeddingModel = snapshot.get("embeddingModel");
  config.llm.imageModel = snapshot.get("imageModel");
  config.persona.styleModel = snapshot.get("personaStyleModel");
  config.llm.reasoningEffort = snapshot.get("reasoningEffort");
  config.llm.maxTokens = snapshot.get("maxTokens");
  config.agent.maxSteps = snapshot.get("agentMaxSteps");
  config.agent.responseTimeoutMs = snapshot.get("agentResponseTimeoutMs");
  config.agent.auxiliaryTimeoutMs = snapshot.get("agentAuxiliaryTimeoutMs");
  config.responder.engagementWindowMs = snapshot.get(
    "responderEngagementWindowMs",
  );
  config.responder.transcriptWindowMs = snapshot.get(
    "responderTranscriptWindowMs",
  );
  config.responder.transcriptMaxMessages = snapshot.get(
    "responderTranscriptMaxMessages",
  );
}

let snapshot: Snapshot | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

const noOpLog = (_message: string): void => {
  // The caller may omit logging when using this module in a test.
};

export async function initializeDynamicConfig(options: {
  readonly environment?: InitFeatureFlagsOptions["environment"];
  readonly provider?: InitFeatureFlagsOptions["provider"];
  readonly log?: (message: string) => void;
  readonly config?: Config;
  readonly startPolling?: boolean;
}): Promise<void> {
  const log = options.log ?? noOpLog;
  await initFeatureFlags({
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    metrics: featureFlagMetrics,
    onInitializationFailure: log,
  });
  const config = options.config ?? getConfig();
  const holder = createSnapshot(options.environment ?? Bun.env, config, log);
  snapshot = holder.snapshot;
  await snapshot.refresh();
  applySnapshot(snapshot, config);
  if (options.startPolling !== false) {
    pollTimer ??= setInterval(() => {
      void refreshDynamicConfig();
    }, 60_000);
    pollTimer.unref();
  }
}

export function isDynamicConfigReady(): boolean {
  return snapshot !== undefined;
}

export async function refreshDynamicConfig(): Promise<void> {
  if (snapshot === undefined) {
    return;
  }
  await snapshot.refresh();
  applySnapshot(snapshot, getConfig());
}

export async function shutdownDynamicConfig(): Promise<void> {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
  snapshot = undefined;
  await shutdownFeatureFlags();
}
