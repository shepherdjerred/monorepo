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
  const token = Bun.env["DISCORD_TOKEN"];
  if (token == null || token.length === 0) {
    return undefined;
  }

  const channelId = Bun.env["DISCORD_CHANNEL_ID"];
  const guildId = Bun.env["DISCORD_GUILD_ID"];

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
    approverRoleIds: parseStringArray(Bun.env["DISCORD_APPROVER_ROLE_IDS"]),
  };
}

function loadConfigFromEnv(): Config {
  return ConfigSchema.parse({
    anthropic: {
      apiKey: Bun.env["ANTHROPIC_API_KEY"] ?? "",
      model: Bun.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-20250514",
    },
    discord: buildDiscordConfig(),
    sentry: {
      dsn: Bun.env["SENTRY_DSN"],
      enabled: parseBoolean(Bun.env["SENTRY_ENABLED"], false),
      environment: Bun.env["SENTRY_ENVIRONMENT"] ?? "development",
    },
    telemetry: {
      enabled: parseBoolean(Bun.env["TELEMETRY_ENABLED"], true),
    },
    queue: {
      pollIntervalMs: parseNumber(Bun.env["QUEUE_POLL_INTERVAL_MS"], 5000),
      maxJobDurationMs: parseNumber(
        Bun.env["QUEUE_MAX_JOB_DURATION_MS"],
        600_000,
      ),
      defaultMaxRetries: parseNumber(Bun.env["QUEUE_DEFAULT_MAX_RETRIES"], 3),
    },
    webhooks: {
      port: parseNumber(Bun.env["WEBHOOKS_PORT"], 3000),
      host: Bun.env["WEBHOOKS_HOST"] ?? "0.0.0.0",
      githubSecret: Bun.env["GITHUB_WEBHOOK_SECRET"],
      pagerdutySecret: Bun.env["PAGERDUTY_WEBHOOK_SECRET"],
      bugsinkSecret: Bun.env["BUGSINK_WEBHOOK_SECRET"],
      buildkiteToken: Bun.env["BUILDKITE_WEBHOOK_TOKEN"],
    },
    permissions: {
      approvalTimeoutMs: parseNumber(Bun.env["APPROVAL_TIMEOUT_MS"], 1_800_000),
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
