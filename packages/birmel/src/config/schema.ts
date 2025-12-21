import { z } from "zod";

export const DiscordConfigSchema = z.object({
  token: z.string().min(1, "DISCORD_TOKEN is required"),
  clientId: z.string().min(1, "DISCORD_CLIENT_ID is required"),
});

export const AnthropicConfigSchema = z.object({
  apiKey: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  model: z.string().default("claude-sonnet-4-20250514"),
  maxTokens: z.number().default(4096),
});

export const OpenAIConfigSchema = z.object({
  apiKey: z.string().min(1, "OPENAI_API_KEY is required"),
  whisperModel: z.string().default("whisper-1"),
  ttsModel: z.string().default("tts-1"),
  ttsVoice: z
    .enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"])
    .default("nova"),
  ttsSpeed: z.number().min(0.25).max(4.0).default(1.0),
});

export const DatabaseConfigSchema = z.object({
  path: z.string().default("./data/birmel.db"),
});

export const DailyPostsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Time must be HH:MM format")
    .default("09:00"),
  timezone: z.string().default("America/Los_Angeles"),
});

export const VoiceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  silenceThresholdMs: z.number().default(1500),
  maxRecordingMs: z.number().default(30000),
});

export const ExternalApisSchema = z.object({
  newsApiKey: z.string().optional(),
  riotApiKey: z.string().optional(),
});

export const LoggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const ConfigSchema = z.object({
  discord: DiscordConfigSchema,
  anthropic: AnthropicConfigSchema,
  openai: OpenAIConfigSchema,
  database: DatabaseConfigSchema,
  dailyPosts: DailyPostsConfigSchema,
  voice: VoiceConfigSchema,
  externalApis: ExternalApisSchema,
  logging: LoggingConfigSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;
export type AnthropicConfig = z.infer<typeof AnthropicConfigSchema>;
export type OpenAIConfig = z.infer<typeof OpenAIConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type DailyPostsConfig = z.infer<typeof DailyPostsConfigSchema>;
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
export type ExternalApisConfig = z.infer<typeof ExternalApisSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
