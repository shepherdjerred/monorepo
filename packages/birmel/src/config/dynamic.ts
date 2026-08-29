import { defineConfig } from "@shepherdjerred/config";
import { createConfigSnapshot } from "@shepherdjerred/config/snapshot.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";
import { featureFlagMetrics } from "@shepherdjerred/birmel/observability/metrics.ts";
import { getConfig } from "./index.ts";
import type { Config } from "./schema.ts";

const DynamicBooleanSchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value.toLowerCase() === "true"
        ? true
        : value.toLowerCase() === "false"
          ? false
          : value
      : value,
  z.boolean(),
);
const PositiveIntegerSchema = z.coerce.number().int().positive();
const MaxStepsSchema = z.coerce.number().int().min(1).max(8);
const ReasoningEffortSchema = z.enum(["minimal", "low", "medium", "high"]);
const StringSchema = z.string().trim().min(1);

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
    schema: StringSchema,
    sources: ["flag", "env", "default"],
    default: "gpt-5.6-luna",
    names: { flag: "birmel-llm-model", env: "LLM_MODEL" },
  },
  classifierModel: {
    schema: StringSchema,
    sources: ["flag", "env", "default"],
    default: "gpt-5.4-nano",
    names: { flag: "birmel-llm-classifier-model", env: "LLM_CLASSIFIER_MODEL" },
  },
  memoryModel: {
    schema: StringSchema,
    sources: ["flag", "env", "default"],
    default: "gpt-5.4-nano",
    names: { flag: "birmel-llm-memory-model", env: "LLM_MEMORY_MODEL" },
  },
  embeddingModel: {
    schema: StringSchema,
    sources: ["flag", "env", "default"],
    default: "text-embedding-3-small",
    names: { flag: "birmel-llm-embedding-model", env: "LLM_EMBEDDING_MODEL" },
  },
  personaStyleModel: {
    schema: StringSchema,
    sources: ["flag", "env", "default"],
    default: "gpt-5.4-nano",
    names: { flag: "birmel-persona-style-model", env: "PERSONA_STYLE_MODEL" },
  },
  reasoningEffort: {
    schema: ReasoningEffortSchema,
    sources: ["flag", "env", "default"],
    default: "medium",
    names: { flag: "birmel-llm-reasoning-effort", env: "LLM_REASONING_EFFORT" },
  },
  maxTokens: {
    schema: PositiveIntegerSchema,
    sources: ["flag", "env", "default"],
    default: 4096,
    names: {
      flag: "birmel-llm-max-output-tokens",
      env: "LLM_MAX_OUTPUT_TOKENS",
    },
  },
  agentMaxSteps: {
    schema: MaxStepsSchema,
    sources: ["flag", "env", "default"],
    default: 8,
    names: { flag: "birmel-agent-max-steps", env: "AGENT_MAX_STEPS" },
  },
  agentResponseTimeoutMs: {
    schema: PositiveIntegerSchema,
    sources: ["flag", "env", "default"],
    default: 120_000,
    names: {
      flag: "birmel-agent-response-timeout-ms",
      env: "AGENT_RESPONSE_TIMEOUT_MS",
    },
  },
  agentRouterTimeoutMs: {
    schema: PositiveIntegerSchema,
    sources: ["flag", "env", "default"],
    default: 30_000,
    names: {
      flag: "birmel-agent-router-timeout-ms",
      env: "AGENT_ROUTER_TIMEOUT_MS",
    },
  },
  responderEngagementWindowMs: {
    schema: PositiveIntegerSchema,
    sources: ["flag", "env", "default"],
    default: 180_000,
    names: {
      flag: "birmel-responder-engagement-window-ms",
      env: "RESPONDER_ENGAGEMENT_WINDOW_MS",
    },
  },
  responderTranscriptWindowMs: {
    schema: PositiveIntegerSchema,
    sources: ["flag", "env", "default"],
    default: 3_600_000,
    names: {
      flag: "birmel-responder-transcript-window-ms",
      env: "RESPONDER_TRANSCRIPT_WINDOW_MS",
    },
  },
  responderTranscriptMaxMessages: {
    schema: z.coerce.number().int().min(1).max(50),
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
          llmModel: "string",
          classifierModel: "string",
          memoryModel: "string",
          embeddingModel: "string",
          personaStyleModel: "string",
          reasoningEffort: "string",
          maxTokens: "number",
          agentMaxSteps: "number",
          agentResponseTimeoutMs: "number",
          agentRouterTimeoutMs: "number",
          responderEngagementWindowMs: "number",
          responderTranscriptWindowMs: "number",
          responderTranscriptMaxMessages: "number",
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
      llmModel: config.openRouter.model,
      classifierModel: config.openRouter.classifierModel,
      memoryModel: config.openRouter.memoryModel,
      embeddingModel: config.openRouter.embeddingModel,
      personaStyleModel: config.persona.styleModel,
      reasoningEffort: config.openRouter.reasoningEffort,
      maxTokens: config.openRouter.maxTokens,
      agentMaxSteps: config.agent.maxSteps,
      agentResponseTimeoutMs: config.agent.responseTimeoutMs,
      agentRouterTimeoutMs: config.agent.routerTimeoutMs,
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
  config.openRouter.model = snapshot.get("llmModel");
  config.openRouter.classifierModel = snapshot.get("classifierModel");
  config.openRouter.memoryModel = snapshot.get("memoryModel");
  config.openRouter.embeddingModel = snapshot.get("embeddingModel");
  config.persona.styleModel = snapshot.get("personaStyleModel");
  config.openRouter.reasoningEffort = snapshot.get("reasoningEffort");
  config.openRouter.maxTokens = snapshot.get("maxTokens");
  config.agent.maxSteps = snapshot.get("agentMaxSteps");
  config.agent.responseTimeoutMs = snapshot.get("agentResponseTimeoutMs");
  config.agent.routerTimeoutMs = snapshot.get("agentRouterTimeoutMs");
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
