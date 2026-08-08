import { z } from "zod";
import { ConfigSchema, type Config } from "./schema.ts";

type Environment = Readonly<Record<string, string | undefined>>;

const BooleanEnvironmentValueSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const NumberEnvironmentValueSchema = z
  .string()
  .trim()
  .min(1)
  .transform(Number)
  .pipe(z.number());

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  return value === undefined
    ? defaultValue
    : BooleanEnvironmentValueSchema.parse(value);
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  return value === undefined
    ? defaultValue
    : NumberEnvironmentValueSchema.parse(value);
}

function parseJson<T>(
  value: string | undefined,
  defaultValue: T,
  schema: z.ZodType<T>,
): T {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed: unknown = JSON.parse(value);
  return schema.parse(parsed);
}

function loadCoreConfig(environment: Environment) {
  return {
    discord: {
      token: environment["DISCORD_TOKEN"] ?? "",
      clientId: environment["DISCORD_CLIENT_ID"] ?? "",
    },
    openai: {
      apiKey: environment["OPENAI_API_KEY"] ?? "",
      model: environment["OPENAI_MODEL"] ?? "gpt-5.6-sol",
      classifierModel: environment["OPENAI_CLASSIFIER_MODEL"] ?? "gpt-5.4-nano",
      memoryModel: environment["OPENAI_MEMORY_MODEL"] ?? "gpt-5.4-nano",
      embeddingModel:
        environment["OPENAI_EMBEDDING_MODEL"] ?? "text-embedding-3-small",
      reasoningEffort: environment["OPENAI_REASONING_EFFORT"] ?? "medium",
      textVerbosity: environment["OPENAI_TEXT_VERBOSITY"] ?? "low",
      maxTokens: parseNumber(environment["OPENAI_MAX_TOKENS"], 4096),
    },
    agent: {
      maxSteps: parseNumber(environment["AGENT_MAX_STEPS"], 8),
      responseTimeoutMs: parseNumber(
        environment["AGENT_RESPONSE_TIMEOUT_MS"],
        120_000,
      ),
      routerTimeoutMs: parseNumber(
        environment["AGENT_ROUTER_TIMEOUT_MS"],
        30_000,
      ),
    },
    authority: {
      trustedUserIds: parseJson(
        environment["TRUSTED_USER_IDS"],
        undefined,
        z.array(z.string().regex(/^\d+$/)).min(1).optional(),
      ),
    },
    telemetry: {
      enabled: parseBoolean(environment["TELEMETRY_ENABLED"], true),
      otlpEndpoint:
        environment["OTLP_ENDPOINT"] ??
        "http://tempo.monitoring.svc.cluster.local:4318",
      serviceName: environment["TELEMETRY_SERVICE_NAME"] ?? "birmel",
    },
    dailyPosts: {
      enabled: parseBoolean(environment["DAILY_POSTS_ENABLED"], true),
      time: environment["DAILY_POST_TIME"] ?? "09:00",
      timezone: environment["DAILY_POST_TIMEZONE"] ?? "America/Los_Angeles",
    },
    externalApis: {
      newsApiKey: environment["NEWS_API_KEY"],
      riotApiKey: environment["RIOT_API_KEY"],
      webSearchProvider: environment["WEB_SEARCH_PROVIDER"] ?? "openai",
    },
    logging: {
      level: environment["LOG_LEVEL"] ?? "info",
    },
  };
}

function loadGithubConfig(environment: Environment) {
  const clientId = environment["EDITOR_GITHUB_CLIENT_ID"];
  if (clientId == null || clientId.length === 0) {
    return;
  }
  return {
    clientId,
    clientSecret: environment["EDITOR_GITHUB_CLIENT_SECRET"] ?? "",
    callbackUrl: environment["EDITOR_GITHUB_CALLBACK_URL"] ?? "",
  };
}

function loadEditorConfig(environment: Environment) {
  return {
    enabled: parseBoolean(environment["EDITOR_ENABLED"], false),
    allowedRepos: parseJson(
      environment["EDITOR_ALLOWED_REPOS"],
      [],
      z.array(
        z.object({
          name: z.string(),
          repo: z.string(),
          allowedPaths: z.array(z.string()).optional(),
          branch: z.string().optional(),
        }),
      ),
    ),
    maxSessionDurationMs: parseNumber(
      environment["EDITOR_MAX_SESSION_DURATION_MS"],
      1_800_000,
    ),
    maxSessionsPerUser: parseNumber(
      environment["EDITOR_MAX_SESSIONS_PER_USER"],
      1,
    ),
    oauthPort: parseNumber(environment["EDITOR_OAUTH_PORT"], 4112),
    oauthHost: environment["EDITOR_OAUTH_HOST"] ?? "0.0.0.0",
    github: loadGithubConfig(environment),
  };
}

function loadFeatureConfig(environment: Environment) {
  return {
    sentry: {
      enabled: parseBoolean(environment["SENTRY_ENABLED"], false),
      dsn: environment["SENTRY_DSN"],
      environment: environment["SENTRY_ENVIRONMENT"] ?? "development",
      release: environment["SENTRY_RELEASE"] ?? environment["GIT_SHA"],
      sampleRate: parseNumber(environment["SENTRY_SAMPLE_RATE"], 1),
      tracesSampleRate: parseNumber(
        environment["SENTRY_TRACES_SAMPLE_RATE"],
        0,
      ),
      debug: parseBoolean(environment["SENTRY_DEBUG"], false),
    },
    persona: {
      enabled: parseBoolean(environment["PERSONA_ENABLED"], true),
      defaultPersona: environment["PERSONA_DEFAULT"] ?? "virmel",
      styleModel: environment["PERSONA_STYLE_MODEL"] ?? "gpt-5.4-nano",
    },
    responder: {
      enabled: parseBoolean(environment["RESPONDER_ENABLED"], true),
      engagementWindowMs: parseNumber(
        environment["RESPONDER_ENGAGEMENT_WINDOW_MS"],
        180_000,
      ),
      transcriptWindowMs: parseNumber(
        environment["RESPONDER_TRANSCRIPT_WINDOW_MS"],
        3_600_000,
      ),
      transcriptMaxMessages: parseNumber(
        environment["RESPONDER_TRANSCRIPT_MAX_MESSAGES"],
        50,
      ),
    },
    shell: {
      enabled: parseBoolean(environment["SHELL_ENABLED"], true),
      defaultTimeout: parseNumber(environment["SHELL_DEFAULT_TIMEOUT"], 30_000),
      maxTimeout: parseNumber(environment["SHELL_MAX_TIMEOUT"], 300_000),
    },
    scheduler: {
      enabled: parseBoolean(environment["SCHEDULER_ENABLED"], true),
      maxTasksPerGuild: parseNumber(
        environment["SCHEDULER_MAX_TASKS_PER_GUILD"],
        100,
      ),
      maxRecurringTasks: parseNumber(
        environment["SCHEDULER_MAX_RECURRING_TASKS"],
        50,
      ),
      maxConcurrentJobs: parseNumber(
        environment["SCHEDULER_MAX_CONCURRENT_JOBS"],
        5,
      ),
      tickIntervalMs: parseNumber(
        environment["SCHEDULER_TICK_INTERVAL_MS"],
        10_000,
      ),
      operationTimeoutMs: parseNumber(
        environment["SCHEDULER_OPERATION_TIMEOUT_MS"],
        30_000,
      ),
      shutdownTimeoutMs: parseNumber(
        environment["SCHEDULER_SHUTDOWN_TIMEOUT_MS"],
        30_000,
      ),
    },
    browser: {
      enabled: parseBoolean(environment["BROWSER_ENABLED"], true),
      provider: environment["BROWSER_PROVIDER"] ?? "pinchtab",
      headless: parseBoolean(environment["BROWSER_HEADLESS"], true),
      viewportWidth: parseNumber(environment["BROWSER_VIEWPORT_WIDTH"], 1280),
      viewportHeight: parseNumber(environment["BROWSER_VIEWPORT_HEIGHT"], 720),
      maxSessions: parseNumber(environment["BROWSER_MAX_SESSIONS"], 5),
      sessionTimeoutMs: parseNumber(
        environment["BROWSER_SESSION_TIMEOUT_MS"],
        300_000,
      ),
      userAgent: environment["BROWSER_USER_AGENT"],
      pinchtabBaseUrl:
        environment["PINCHTAB_BASE_URL"] ?? "http://localhost:9867",
      pinchtabToken: environment["PINCHTAB_TOKEN"],
      pinchtabProfile: environment["PINCHTAB_PROFILE"] ?? "default",
    },
    birthdays: {
      enabled: parseBoolean(environment["BIRTHDAYS_ENABLED"], true),
      defaultTimezone: environment["BIRTHDAYS_DEFAULT_TIMEZONE"] ?? "UTC",
      birthdayRoleId: environment["BIRTHDAYS_ROLE_ID"],
      announcementChannelId: environment["BIRTHDAYS_ANNOUNCEMENT_CHANNEL_ID"],
    },
    activityTracking: {
      enabled: parseBoolean(environment["ACTIVITY_TRACKING_ENABLED"], true),
      roleTiers: parseJson(
        environment["ACTIVITY_ROLE_TIERS"],
        [],
        z.array(z.object({ minimumActivity: z.number(), roleId: z.string() })),
      ),
    },
    elections: {
      enabled: parseBoolean(environment["ELECTIONS_ENABLED"], true),
      startTime: environment["ELECTION_START_TIME"] ?? "17:00",
      endTime: environment["ELECTION_END_TIME"] ?? "19:00",
      timezone: environment["ELECTION_TIMEZONE"] ?? "America/Los_Angeles",
      channelId: environment["ELECTION_CHANNEL_ID"],
    },
    editor: loadEditorConfig(environment),
    health: {
      port: parseNumber(environment["HEALTH_PORT"], 8080),
    },
  };
}

export function loadConfigFromEnvironment(environment: Environment): Config {
  return ConfigSchema.parse({
    ...loadCoreConfig(environment),
    ...loadFeatureConfig(environment),
  });
}

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  cachedConfig ??= loadConfigFromEnvironment(Bun.env);
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
