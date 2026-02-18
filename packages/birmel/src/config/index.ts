import { ConfigSchema, type Config } from "./schema.ts";

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseJSON<T>(value: string | undefined, defaultValue: T): T {
  if (value === undefined) {
    return defaultValue;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

function loadConfigFromEnv(): Config {
  const rawConfig = {
    discord: {
      token: Bun.env["DISCORD_TOKEN"] ?? "",
      clientId: Bun.env["DISCORD_CLIENT_ID"] ?? "",
    },
    openai: {
      apiKey: Bun.env["OPENAI_API_KEY"] ?? "",
      model: Bun.env["OPENAI_MODEL"] ?? "gpt-5-mini",
      classifierModel: Bun.env["OPENAI_CLASSIFIER_MODEL"] ?? "gpt-5-nano",
      maxTokens: parseNumber(Bun.env["OPENAI_MAX_TOKENS"], 4096),
    },
    mastra: {
      memoryDbPath:
        Bun.env["MASTRA_MEMORY_DB_PATH"] ??
        "file:/app/data/mastra-memory.db",
      telemetryDbPath:
        Bun.env["MASTRA_TELEMETRY_DB_PATH"] ??
        "file:/app/data/mastra-telemetry.db",
      studioEnabled: parseBoolean(Bun.env["MASTRA_STUDIO_ENABLED"], true),
      studioPort: parseNumber(Bun.env["MASTRA_STUDIO_PORT"], 4111),
      studioHost: Bun.env["MASTRA_STUDIO_HOST"] ?? "0.0.0.0",
    },
    telemetry: {
      enabled: parseBoolean(Bun.env["TELEMETRY_ENABLED"], true),
      otlpEndpoint:
        Bun.env["OTLP_ENDPOINT"] ??
        "http://tempo.monitoring.svc.cluster.local:4318",
      serviceName: Bun.env["TELEMETRY_SERVICE_NAME"] ?? "birmel",
    },
    dailyPosts: {
      enabled: parseBoolean(Bun.env["DAILY_POSTS_ENABLED"], true),
      time: Bun.env["DAILY_POST_TIME"] ?? "09:00",
      timezone: Bun.env["DAILY_POST_TIMEZONE"] ?? "America/Los_Angeles",
    },
    externalApis: {
      newsApiKey: Bun.env["NEWS_API_KEY"],
      riotApiKey: Bun.env["RIOT_API_KEY"],
    },
    logging: {
      level: Bun.env["LOG_LEVEL"] ?? "info",
    },
    sentry: {
      enabled: parseBoolean(Bun.env["SENTRY_ENABLED"], false),
      dsn: Bun.env["SENTRY_DSN"],
      environment: Bun.env["SENTRY_ENVIRONMENT"] ?? "development",
      release: Bun.env["SENTRY_RELEASE"] ?? Bun.env["GIT_SHA"],
      sampleRate: parseNumber(Bun.env["SENTRY_SAMPLE_RATE"], 1),
      tracesSampleRate: parseNumber(
        Bun.env["SENTRY_TRACES_SAMPLE_RATE"],
        0.1,
      ),
    },
    persona: {
      enabled: parseBoolean(Bun.env["PERSONA_ENABLED"], true),
      defaultPersona: Bun.env["PERSONA_DEFAULT"] ?? "virmel",
      styleModel: Bun.env["PERSONA_STYLE_MODEL"] ?? "gpt-4o-mini",
    },
    shell: {
      enabled: parseBoolean(Bun.env["SHELL_ENABLED"], true),
      defaultTimeout: parseNumber(Bun.env["SHELL_DEFAULT_TIMEOUT"], 30_000),
      maxTimeout: parseNumber(Bun.env["SHELL_MAX_TIMEOUT"], 300_000),
    },
    scheduler: {
      enabled: parseBoolean(Bun.env["SCHEDULER_ENABLED"], true),
      maxTasksPerGuild: parseNumber(
        Bun.env["SCHEDULER_MAX_TASKS_PER_GUILD"],
        100,
      ),
      maxRecurringTasks: parseNumber(
        Bun.env["SCHEDULER_MAX_RECURRING_TASKS"],
        50,
      ),
    },
    browser: {
      enabled: parseBoolean(Bun.env["BROWSER_ENABLED"], true),
      headless: parseBoolean(Bun.env["BROWSER_HEADLESS"], true),
      viewportWidth: parseNumber(Bun.env["BROWSER_VIEWPORT_WIDTH"], 1280),
      viewportHeight: parseNumber(Bun.env["BROWSER_VIEWPORT_HEIGHT"], 720),
      maxSessions: parseNumber(Bun.env["BROWSER_MAX_SESSIONS"], 5),
      sessionTimeoutMs: parseNumber(
        Bun.env["BROWSER_SESSION_TIMEOUT_MS"],
        300_000,
      ),
      userAgent: Bun.env["BROWSER_USER_AGENT"],
    },
    birthdays: {
      enabled: parseBoolean(Bun.env["BIRTHDAYS_ENABLED"], true),
      defaultTimezone: Bun.env["BIRTHDAYS_DEFAULT_TIMEZONE"] ?? "UTC",
      birthdayRoleId: Bun.env["BIRTHDAYS_ROLE_ID"],
      announcementChannelId: Bun.env["BIRTHDAYS_ANNOUNCEMENT_CHANNEL_ID"],
    },
    activityTracking: {
      enabled: parseBoolean(Bun.env["ACTIVITY_TRACKING_ENABLED"], true),
      roleTiers: parseJSON<{ minimumActivity: number; roleId: string }[]>(
        Bun.env["ACTIVITY_ROLE_TIERS"],
        [],
      ),
    },
    elections: {
      enabled: parseBoolean(Bun.env["ELECTIONS_ENABLED"], true),
      startTime: Bun.env["ELECTION_START_TIME"] ?? "17:00",
      endTime: Bun.env["ELECTION_END_TIME"] ?? "19:00",
      timezone: Bun.env["ELECTION_TIMEZONE"] ?? "America/Los_Angeles",
      channelId: Bun.env["ELECTION_CHANNEL_ID"],
    },
    editor: {
      enabled: parseBoolean(Bun.env["EDITOR_ENABLED"], false),
      allowedRepos: parseJSON<
        {
          name: string;
          repo: string;
          allowedPaths?: string[];
          branch?: string;
        }[]
      >(Bun.env["EDITOR_ALLOWED_REPOS"], []),
      maxSessionDurationMs: parseNumber(
        Bun.env["EDITOR_MAX_SESSION_DURATION_MS"],
        1_800_000,
      ),
      maxSessionsPerUser: parseNumber(
        Bun.env["EDITOR_MAX_SESSIONS_PER_USER"],
        1,
      ),
      oauthPort: parseNumber(Bun.env["EDITOR_OAUTH_PORT"], 4112),
      oauthHost: Bun.env["EDITOR_OAUTH_HOST"] ?? "0.0.0.0",
      github:
        Bun.env["EDITOR_GITHUB_CLIENT_ID"] != null &&
        Bun.env["EDITOR_GITHUB_CLIENT_ID"].length > 0
          ? {
              clientId: Bun.env["EDITOR_GITHUB_CLIENT_ID"] ?? "",
              clientSecret: Bun.env["EDITOR_GITHUB_CLIENT_SECRET"] ?? "",
              callbackUrl: Bun.env["EDITOR_GITHUB_CALLBACK_URL"] ?? "",
            }
          : undefined,
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
