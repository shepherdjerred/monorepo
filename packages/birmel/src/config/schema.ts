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
  telemetryDbPath: z.string().default("file:/app/data/mastra-telemetry.db"),
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
  dbPath: z.string().default("file:/app/data/glitter-boys.db"),
  decisionExampleCount: z.number().default(5),
  styleExampleCount: z.number().default(10),
  styleModel: z.string().default("gpt-4o-mini"),
});

export const BirthdayConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTimezone: z.string().default("UTC"),
  birthdayRoleId: z.string().optional(),
  announcementChannelId: z.string().optional(),
});

export const ActivityTrackingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  roleTiers: z
    .array(
      z.object({
        minimumActivity: z.number().min(0),
        roleId: z.string(),
      })
    )
    .default([]),
});

export const ShellConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTimeout: z.number().default(30000),
  maxTimeout: z.number().default(300000),
});

export const SchedulerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxTasksPerGuild: z.number().default(100),
  maxRecurringTasks: z.number().default(50),
});

export const BrowserConfigSchema = z.object({
  enabled: z.boolean().default(true),
  headless: z.boolean().default(true),
  viewportWidth: z.number().default(1280),
  viewportHeight: z.number().default(720),
  maxSessions: z.number().default(5),
  sessionTimeoutMs: z.number().default(300000),
  userAgent: z.string().optional(),
});

export const ElectionsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  startTime: z.string().default("17:00"),
  endTime: z.string().default("19:00"),
  timezone: z.string().default("America/Los_Angeles"),
  channelId: z.string().optional(),
});

export const ClaudeCodeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  repoPath: z.string().default("/app/monorepo"),
  subPath: z.string().default("packages/birmel"),
  defaultTimeout: z.number().default(600000), // 10 minutes
  maxTimeout: z.number().default(900000), // 15 minutes
  maxRequestsPerHour: z.number().default(5),
  branchPrefix: z.string().default("claude/discord-request"),
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
  shell: ShellConfigSchema,
  scheduler: SchedulerConfigSchema,
  browser: BrowserConfigSchema,
  birthdays: BirthdayConfigSchema,
  activityTracking: ActivityTrackingConfigSchema,
  elections: ElectionsConfigSchema,
  claudeCode: ClaudeCodeConfigSchema,
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
export type ShellConfig = z.infer<typeof ShellConfigSchema>;
export type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
export type BirthdayConfig = z.infer<typeof BirthdayConfigSchema>;
export type ActivityTrackingConfig = z.infer<typeof ActivityTrackingConfigSchema>;
export type ElectionsConfig = z.infer<typeof ElectionsConfigSchema>;
export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfigSchema>;
