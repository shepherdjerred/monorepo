import { z } from "zod";

export const AnthropicConfigSchema = z.object({
  apiKey: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  model: z.string().default("claude-sonnet-4-20250514"),
});

export const DiscordConfigSchema = z.object({
  token: z.string().min(1, "DISCORD_TOKEN is required"),
  channelId: z.string().min(1, "DISCORD_CHANNEL_ID is required"),
  guildId: z.string().min(1, "DISCORD_GUILD_ID is required"),
  approverRoleIds: z.array(z.string()).default([]),
});

export const SentryConfigSchema = z.object({
  dsn: z.string().optional(),
  enabled: z.boolean().default(false),
  environment: z
    .enum(["development", "staging", "production"])
    .default("development"),
});

export const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

export const QueueConfigSchema = z.object({
  pollIntervalMs: z.number().default(5000),
  maxJobDurationMs: z.number().default(600_000),
  defaultMaxRetries: z.number().default(3),
});

export const WebhooksConfigSchema = z.object({
  port: z.number().default(3000),
  host: z.string().default("0.0.0.0"),
  githubSecret: z.string().optional(),
  pagerdutySecret: z.string().optional(),
  bugsinkSecret: z.string().optional(),
  buildkiteToken: z.string().optional(),
});

export const PermissionsConfigSchema = z.object({
  approvalTimeoutMs: z.number().default(1_800_000),
});

export const ConfigSchema = z.object({
  anthropic: AnthropicConfigSchema,
  discord: DiscordConfigSchema.optional(),
  sentry: SentryConfigSchema,
  telemetry: TelemetryConfigSchema,
  queue: QueueConfigSchema,
  webhooks: WebhooksConfigSchema,
  permissions: PermissionsConfigSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
