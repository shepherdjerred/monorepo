import { z } from "zod";

export const DiscordConfigSchema = z.object({
  token: z.string().min(1, "DISCORD_TOKEN is required"),
  clientId: z.string().min(1, "DISCORD_CLIENT_ID is required"),
});

export const OpenAIConfigSchema = z.object({
  apiKey: z.string().min(1, "OPENAI_API_KEY is required"),
  model: z.string().default("gpt-5-mini"),
  classifierModel: z.string().default("gpt-5-nano"),
  maxTokens: z.number().default(4096),
  whisperModel: z.string().default("whisper-1"),
  ttsModel: z.string().default("tts-1"),
  ttsVoice: z
    .enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"])
    .default("nova"),
  ttsSpeed: z.number().min(0.25).max(4.0).default(1.0),
});

export const MastraConfigSchema = z.object({
  memoryDbPath: z.string().default("file:/app/data/mastra-memory.db"),
  studioEnabled: z.boolean().default(true),
  studioPort: z.number().default(4111),
  studioHost: z.string().default("0.0.0.0"),
});

export const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  otlpEndpoint: z
    .string()
    .default("http://tempo.monitoring.svc.cluster.local:4318"),
  serviceName: z.string().default("birmel"),
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

export const SentryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  dsn: z.string().optional(),
  environment: z
    .enum(["development", "staging", "production"])
    .default("development"),
  release: z.string().optional(),
  sampleRate: z.number().min(0).max(1).default(1.0),
  tracesSampleRate: z.number().min(0).max(1).default(0.1),
});

export const PersonaConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultPersona: z.string().default("virmel"),
  dbPath: z.string().default("./glitter-boys.db"),
  decisionExampleCount: z.number().default(20),
  styleExampleCount: z.number().default(50),
  styleModel: z.string().default("gpt-4o-mini"),
});

export const ConfigSchema = z.object({
  discord: DiscordConfigSchema,
  openai: OpenAIConfigSchema,
  mastra: MastraConfigSchema,
  telemetry: TelemetryConfigSchema,
  dailyPosts: DailyPostsConfigSchema,
  voice: VoiceConfigSchema,
  externalApis: ExternalApisSchema,
  logging: LoggingConfigSchema,
  sentry: SentryConfigSchema,
  persona: PersonaConfigSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;
export type OpenAIConfig = z.infer<typeof OpenAIConfigSchema>;
export type MastraConfig = z.infer<typeof MastraConfigSchema>;
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
export type DailyPostsConfig = z.infer<typeof DailyPostsConfigSchema>;
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
export type ExternalApisConfig = z.infer<typeof ExternalApisSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type SentryConfig = z.infer<typeof SentryConfigSchema>;
export type PersonaConfig = z.infer<typeof PersonaConfigSchema>;
