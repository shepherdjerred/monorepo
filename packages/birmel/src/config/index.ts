import { ConfigSchema, type Config } from "./schema.js";

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseJSON<T>(value: string | undefined, defaultValue: T): T {
  if (value === undefined) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

function loadConfigFromEnv(): Config {
  const rawConfig = {
    discord: {
      token: process.env["DISCORD_TOKEN"] ?? "",
      clientId: process.env["DISCORD_CLIENT_ID"] ?? "",
    },
    openai: {
      apiKey: process.env["OPENAI_API_KEY"] ?? "",
      model: process.env["OPENAI_MODEL"] ?? "gpt-5-mini",
      classifierModel: process.env["OPENAI_CLASSIFIER_MODEL"] ?? "gpt-5-nano",
      maxTokens: parseNumber(process.env["OPENAI_MAX_TOKENS"], 4096),
      whisperModel: process.env["WHISPER_MODEL"] ?? "whisper-1",
      ttsModel: process.env["TTS_MODEL"] ?? "tts-1",
      ttsVoice: process.env["TTS_VOICE"] ?? "nova",
      ttsSpeed: parseNumber(process.env["TTS_SPEED"], 1.0),
    },
    mastra: {
      memoryDbPath:
        process.env["MASTRA_MEMORY_DB_PATH"] ??
        "file:/app/data/mastra-memory.db",
      telemetryDbPath:
        process.env["MASTRA_TELEMETRY_DB_PATH"] ??
        "file:/app/data/mastra-telemetry.db",
      studioEnabled: parseBoolean(process.env["MASTRA_STUDIO_ENABLED"], true),
      studioPort: parseNumber(process.env["MASTRA_STUDIO_PORT"], 4111),
      studioHost: process.env["MASTRA_STUDIO_HOST"] ?? "0.0.0.0",
    },
    telemetry: {
      enabled: parseBoolean(process.env["TELEMETRY_ENABLED"], true),
      otlpEndpoint:
        process.env["OTLP_ENDPOINT"] ??
        "http://tempo.monitoring.svc.cluster.local:4318",
      serviceName: process.env["TELEMETRY_SERVICE_NAME"] ?? "birmel",
    },
    dailyPosts: {
      enabled: parseBoolean(process.env["DAILY_POSTS_ENABLED"], true),
      time: process.env["DAILY_POST_TIME"] ?? "09:00",
      timezone: process.env["DAILY_POST_TIMEZONE"] ?? "America/Los_Angeles",
    },
    voice: {
      enabled: parseBoolean(process.env["VOICE_ENABLED"], true),
      silenceThresholdMs: parseNumber(
        process.env["VOICE_SILENCE_THRESHOLD_MS"],
        1500,
      ),
      maxRecordingMs: parseNumber(
        process.env["VOICE_MAX_RECORDING_MS"],
        30000,
      ),
    },
    externalApis: {
      newsApiKey: process.env["NEWS_API_KEY"],
      riotApiKey: process.env["RIOT_API_KEY"],
    },
    logging: {
      level: process.env["LOG_LEVEL"] ?? "info",
    },
    sentry: {
      enabled: parseBoolean(process.env["SENTRY_ENABLED"], false),
      dsn: process.env["SENTRY_DSN"],
      environment: process.env["SENTRY_ENVIRONMENT"] ?? "development",
      release: process.env["SENTRY_RELEASE"] ?? process.env["GIT_SHA"],
      sampleRate: parseNumber(process.env["SENTRY_SAMPLE_RATE"], 1.0),
      tracesSampleRate: parseNumber(process.env["SENTRY_TRACES_SAMPLE_RATE"], 0.1),
    },
    persona: {
      enabled: parseBoolean(process.env["PERSONA_ENABLED"], true),
      defaultPersona: process.env["PERSONA_DEFAULT"] ?? "virmel",
      dbPath: process.env["PERSONA_DB_PATH"] ?? "./glitter-boys.db",
      decisionExampleCount: parseNumber(
        process.env["PERSONA_DECISION_COUNT"],
        20,
      ),
      styleExampleCount: parseNumber(process.env["PERSONA_STYLE_COUNT"], 50),
      styleModel: process.env["PERSONA_STYLE_MODEL"] ?? "gpt-4o-mini",
    },
    shell: {
      enabled: parseBoolean(process.env["SHELL_ENABLED"], true),
      defaultTimeout: parseNumber(process.env["SHELL_DEFAULT_TIMEOUT"], 30000),
      maxTimeout: parseNumber(process.env["SHELL_MAX_TIMEOUT"], 300000),
    },
    scheduler: {
      enabled: parseBoolean(process.env["SCHEDULER_ENABLED"], true),
      maxTasksPerGuild: parseNumber(process.env["SCHEDULER_MAX_TASKS_PER_GUILD"], 100),
      maxRecurringTasks: parseNumber(process.env["SCHEDULER_MAX_RECURRING_TASKS"], 50),
    },
    browser: {
      enabled: parseBoolean(process.env["BROWSER_ENABLED"], true),
      headless: parseBoolean(process.env["BROWSER_HEADLESS"], true),
      viewportWidth: parseNumber(process.env["BROWSER_VIEWPORT_WIDTH"], 1280),
      viewportHeight: parseNumber(process.env["BROWSER_VIEWPORT_HEIGHT"], 720),
      maxSessions: parseNumber(process.env["BROWSER_MAX_SESSIONS"], 5),
      sessionTimeoutMs: parseNumber(process.env["BROWSER_SESSION_TIMEOUT_MS"], 300000),
      userAgent: process.env["BROWSER_USER_AGENT"],
    },
    birthdays: {
      enabled: parseBoolean(process.env["BIRTHDAYS_ENABLED"], true),
      defaultTimezone: process.env["BIRTHDAYS_DEFAULT_TIMEZONE"] ?? "UTC",
      birthdayRoleId: process.env["BIRTHDAYS_ROLE_ID"],
      announcementChannelId: process.env["BIRTHDAYS_ANNOUNCEMENT_CHANNEL_ID"],
    },
    activityTracking: {
      enabled: parseBoolean(process.env["ACTIVITY_TRACKING_ENABLED"], true),
      roleTiers: parseJSON<{ minimumActivity: number; roleId: string }[]>(
        process.env["ACTIVITY_ROLE_TIERS"],
        [],
      ),
    },
    elections: {
      enabled: parseBoolean(process.env["ELECTIONS_ENABLED"], true),
      startTime: process.env["ELECTION_START_TIME"] ?? "17:00",
      endTime: process.env["ELECTION_END_TIME"] ?? "19:00",
      timezone: process.env["ELECTION_TIMEZONE"] ?? "America/Los_Angeles",
      channelId: process.env["ELECTION_CHANNEL_ID"],
    },
    claudeCode: {
      enabled: parseBoolean(process.env["CLAUDE_CODE_ENABLED"], false),
      repoPath: process.env["CLAUDE_CODE_REPO_PATH"] ?? "/app/monorepo",
      subPath: process.env["CLAUDE_CODE_SUB_PATH"] ?? "packages/birmel",
      defaultTimeout: parseNumber(process.env["CLAUDE_CODE_DEFAULT_TIMEOUT"], 600000),
      maxTimeout: parseNumber(process.env["CLAUDE_CODE_MAX_TIMEOUT"], 900000),
      maxRequestsPerHour: parseNumber(process.env["CLAUDE_CODE_MAX_REQUESTS_PER_HOUR"], 5),
      branchPrefix: process.env["CLAUDE_CODE_BRANCH_PREFIX"] ?? "claude/discord-request",
    },
  };

  return ConfigSchema.parse(rawConfig);
}

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  cachedConfig ??= loadConfigFromEnv();
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}

export * from "./schema.js";
export * from "./constants.js";
