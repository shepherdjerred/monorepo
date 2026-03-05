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

function parseStringArray(value: string | undefined): string[] {
  if (value === undefined || value.length === 0) {
    return [];
  }
  return value.split(",").map((s) => s.trim());
}

function buildDiscordConfig():
  | {
      token: string;
      channelId: string;
      guildId: string;
      approverRoleIds: string[];
    }
  | undefined {
  const token = resolveEnv("DISCORD_TOKEN");
  if (token == null || token.length === 0) {
    return undefined;
  }

  const channelId = resolveEnv("DISCORD_CHANNEL_ID");
  const guildId = resolveEnv("DISCORD_GUILD_ID");

  if (channelId == null || channelId.length === 0) {
    throw new Error("DISCORD_CHANNEL_ID is required when DISCORD_TOKEN is set");
  }
  if (guildId == null || guildId.length === 0) {
    throw new Error("DISCORD_GUILD_ID is required when DISCORD_TOKEN is set");
  }

  return {
    token,
    channelId,
    guildId,
    approverRoleIds: parseStringArray(resolveEnv("DISCORD_APPROVER_ROLE_IDS")),
  };
}

/**
 * Resolve an env var value, skipping unresolved 1Password `op://` references.
 * Returns undefined for `op://` values so they fall through to optional handling.
 */
function resolveEnv(key: string): string | undefined {
  const value = Bun.env[key];
  if (value == null || value.startsWith("op://")) {
    return undefined;
  }
  return value;
}

function loadConfigFromEnv(): Config {
  return ConfigSchema.parse({
    anthropic: {
      apiKey: resolveEnv("ANTHROPIC_API_KEY") ?? "",
      model: resolveEnv("ANTHROPIC_MODEL") ?? "claude-sonnet-4-20250514",
    },
    discord: buildDiscordConfig(),
    sentry: {
      dsn: resolveEnv("SENTRY_DSN"),
      enabled: parseBoolean(resolveEnv("SENTRY_ENABLED"), false),
      environment: resolveEnv("SENTRY_ENVIRONMENT") ?? "development",
    },
    telemetry: {
      enabled: parseBoolean(resolveEnv("TELEMETRY_ENABLED"), true),
    },
    queue: {
      pollIntervalMs: parseNumber(resolveEnv("QUEUE_POLL_INTERVAL_MS"), 5000),
      maxJobDurationMs: parseNumber(
        resolveEnv("QUEUE_MAX_JOB_DURATION_MS"),
        600_000,
      ),
      defaultMaxRetries: parseNumber(
        resolveEnv("QUEUE_DEFAULT_MAX_RETRIES"),
        3,
      ),
      maxConcurrentJobs: parseNumber(
        resolveEnv("QUEUE_MAX_CONCURRENT_JOBS"),
        3,
      ),
    },
    webhooks: {
      port: parseNumber(resolveEnv("WEBHOOKS_PORT"), 3000),
      host: resolveEnv("WEBHOOKS_HOST") ?? "0.0.0.0",
      githubSecret: resolveEnv("GITHUB_WEBHOOK_SECRET"),
      pagerdutySecret: resolveEnv("PAGERDUTY_WEBHOOK_SECRET"),
      bugsinkSecret: resolveEnv("BUGSINK_WEBHOOK_SECRET"),
      buildkiteToken: resolveEnv("BUILDKITE_WEBHOOK_TOKEN"),
    },
    permissions: {
      approvalTimeoutMs: parseNumber(
        resolveEnv("APPROVAL_TIMEOUT_MS"),
        1_800_000,
      ),
    },
  });
}

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  cachedConfig ??= loadConfigFromEnv();
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
