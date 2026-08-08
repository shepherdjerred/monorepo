import { z } from "zod";

const DiscordIdSchema = z
  .string()
  .regex(/^\d{17,20}$/, "Must be a 17-20 digit Discord snowflake");
const IanaTimezoneSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Must be a valid IANA timezone");

export const DEFAULT_TRUSTED_USER_IDS = [
  "186665676134547461",
  "202595851678384137",
  "410595870380392458",
  "200067001035653131",
  "263577791105073152",
  "208425244128444418",
  "251485022429642752",
  "160509172704739328",
  "171455587517857796",
  "331238905619677185",
  "121887985896521732",
  "528096854831792159",
  "208404668026454016",
  "175488352949108736",
  "138906561895464960",
  "212824118670786560",
  "282716540053225472",
  "697028723257638922",
] as const;

export const DiscordConfigSchema = z.object({
  token: z.string().min(1, "DISCORD_TOKEN is required"),
  clientId: DiscordIdSchema,
});

export const OpenAIConfigSchema = z.object({
  apiKey: z.string().min(1, "OPENAI_API_KEY is required"),
  model: z.string().trim().min(1).default("gpt-5.6-sol"),
  classifierModel: z.string().trim().min(1).default("gpt-5.4-nano"),
  memoryModel: z.string().trim().min(1).default("gpt-5.4-nano"),
  embeddingModel: z.string().trim().min(1).default("text-embedding-3-small"),
  reasoningEffort: z
    .enum(["minimal", "low", "medium", "high"])
    .default("medium"),
  textVerbosity: z.enum(["low", "medium", "high"]).default("low"),
  maxTokens: z.number().int().positive().default(4096),
});

export const AgentConfigSchema = z.object({
  maxSteps: z.number().int().min(1).max(8).default(8),
  responseTimeoutMs: z.number().int().positive().default(120_000),
  routerTimeoutMs: z.number().int().positive().default(30_000),
});

export const AuthorityConfigSchema = z.object({
  trustedUserIds: z
    .array(DiscordIdSchema)
    .min(1)
    .default([...DEFAULT_TRUSTED_USER_IDS]),
});

export const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  otlpEndpoint: z.url().default("http://tempo.tempo.svc.cluster.local:4318"),
  serviceName: z.string().default("birmel"),
});

export const DailyPostsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Time must be HH:MM format")
    .default("09:00"),
  timezone: IanaTimezoneSchema.default("America/Los_Angeles"),
});

export const ExternalApisSchema = z.object({
  newsApiKey: z.string().optional(),
  riotApiKey: z.string().optional(),
  webSearchProvider: z.enum(["openai", "duckduckgo"]).default("openai"),
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
  sampleRate: z.number().min(0).max(1).default(1),
  // Bugsink does not support performance monitoring; keep traces off.
  tracesSampleRate: z.number().min(0).max(1).default(0),
  // When true, the SDK prints its internal transport/queue activity to stderr
  // and our `beforeSend` hook still emits a log line per captured event. Use
  // when triaging "events sent but not visible in Bugsink" issues.
  debug: z.boolean().default(false),
});

export const PersonaConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultPersona: z.string().default("virmel"),
  styleModel: z.string().default("gpt-5.4-nano"),
});

/**
 * Conversational-trigger configuration.
 *
 * After the bot has been directly engaged in a channel (an @mention or wake
 * word), it stays "engaged" for `engagementWindowMs`. While engaged, each
 * subsequent allowed-user message is run through a cheap GPT-nano classifier
 * (`openai.classifierModel`) to decide whether to respond — enabling natural
 * follow-up without re-pinging. Transcript bounds control how much recent
 * channel history is fed to the classifier and the main agent.
 */
export const ResponderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  // How long a channel stays "engaged" after the bot is talked to (3 min).
  engagementWindowMs: z.number().int().positive().default(180_000),
  // Always include at least this many of the most recent messages...
  // ...plus every message newer than this (1 hour), whichever set is larger.
  transcriptWindowMs: z.number().int().positive().default(3_600_000),
  // Hard cap on transcript size for token safety (single Discord fetch page).
  transcriptMaxMessages: z.number().int().min(1).max(50).default(50),
});

export const BirthdayConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTimezone: IanaTimezoneSchema.default("UTC"),
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
      }),
    )
    .default([]),
});

export const ShellConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTimeout: z.number().int().positive().default(30_000),
  maxTimeout: z.number().int().positive().default(300_000),
});

export const SchedulerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxTasksPerGuild: z.number().int().positive().default(100),
  maxRecurringTasks: z.number().int().positive().default(50),
  maxConcurrentJobs: z.number().int().positive().default(5),
  tickIntervalMs: z.number().int().positive().default(10_000),
  operationTimeoutMs: z.number().int().positive().default(30_000),
  shutdownTimeoutMs: z.number().int().positive().default(30_000),
});

export const BrowserConfigSchema = z.object({
  enabled: z.boolean().default(true),
  provider: z.enum(["pinchtab", "playwright"]).default("pinchtab"),
  headless: z.boolean().default(true),
  viewportWidth: z.number().int().positive().default(1280),
  viewportHeight: z.number().int().positive().default(720),
  maxSessions: z.number().int().positive().default(5),
  sessionTimeoutMs: z.number().int().positive().default(300_000),
  userAgent: z.string().optional(),
  pinchtabBaseUrl: z.url().default("http://localhost:9867"),
  pinchtabToken: z.string().optional(),
  pinchtabProfile: z.string().default("default"),
});

export const ElectionsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  startTime: z.string().default("17:00"),
  endTime: z.string().default("19:00"),
  timezone: IanaTimezoneSchema.default("America/Los_Angeles"),
  channelId: z.string().optional(),
  dayOfWeek: z.number().int().min(0).max(6).default(3), // 0=Sunday, 3=Wednesday, 6=Saturday
});

export const EditorRepoConfigSchema = z.object({
  name: z.string(),
  repo: z.string(), // GitHub repo path: "owner/repo"
  allowedPaths: z.array(z.string()).default(["**/*"]),
  branch: z.string().default("main"),
});

export const EditorConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowedRepos: z.array(EditorRepoConfigSchema).default([]),
  maxSessionDurationMs: z.number().int().positive().default(1_800_000), // 30 minutes
  maxSessionsPerUser: z.number().int().positive().default(1),
  oauthPort: z.number().int().min(1).max(65_535).default(4112),
  oauthHost: z.string().default("0.0.0.0"),
  github: z
    .object({
      clientId: z.string(),
      clientSecret: z.string(),
      callbackUrl: z.string(),
    })
    .optional(),
});

export const HealthConfigSchema = z.object({
  port: z.number().int().min(1).max(65_535).default(8080),
});

export const ConfigSchema = z.object({
  discord: DiscordConfigSchema,
  openai: OpenAIConfigSchema,
  agent: AgentConfigSchema,
  authority: AuthorityConfigSchema,
  telemetry: TelemetryConfigSchema,
  dailyPosts: DailyPostsConfigSchema,
  externalApis: ExternalApisSchema,
  logging: LoggingConfigSchema,
  sentry: SentryConfigSchema,
  persona: PersonaConfigSchema,
  responder: ResponderConfigSchema,
  shell: ShellConfigSchema,
  scheduler: SchedulerConfigSchema,
  browser: BrowserConfigSchema,
  birthdays: BirthdayConfigSchema,
  activityTracking: ActivityTrackingConfigSchema,
  elections: ElectionsConfigSchema,
  editor: EditorConfigSchema,
  health: HealthConfigSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;
export type OpenAIConfig = z.infer<typeof OpenAIConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type AuthorityConfig = z.infer<typeof AuthorityConfigSchema>;
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
export type DailyPostsConfig = z.infer<typeof DailyPostsConfigSchema>;
export type ExternalApisConfig = z.infer<typeof ExternalApisSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type SentryConfig = z.infer<typeof SentryConfigSchema>;
export type PersonaConfig = z.infer<typeof PersonaConfigSchema>;
export type ResponderConfig = z.infer<typeof ResponderConfigSchema>;
export type ShellConfig = z.infer<typeof ShellConfigSchema>;
export type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
export type BirthdayConfig = z.infer<typeof BirthdayConfigSchema>;
export type ActivityTrackingConfig = z.infer<
  typeof ActivityTrackingConfigSchema
>;
export type ElectionsConfig = z.infer<typeof ElectionsConfigSchema>;
export type EditorRepoConfig = z.infer<typeof EditorRepoConfigSchema>;
export type EditorConfig = z.infer<typeof EditorConfigSchema>;
export type HealthConfig = z.infer<typeof HealthConfigSchema>;
