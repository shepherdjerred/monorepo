import { ConfigSchema, type Config } from "./schema.js";

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function loadConfigFromEnv(): Config {
  const rawConfig = {
    discord: {
      token: process.env["DISCORD_TOKEN"] ?? "",
      clientId: process.env["DISCORD_CLIENT_ID"] ?? "",
    },
    anthropic: {
      apiKey: process.env["ANTHROPIC_API_KEY"] ?? "",
      model: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-20250514",
      maxTokens: parseNumber(process.env["ANTHROPIC_MAX_TOKENS"], 4096),
    },
    openai: {
      apiKey: process.env["OPENAI_API_KEY"] ?? "",
      whisperModel: process.env["WHISPER_MODEL"] ?? "whisper-1",
      ttsModel: process.env["TTS_MODEL"] ?? "tts-1",
      ttsVoice: process.env["TTS_VOICE"] ?? "nova",
      ttsSpeed: parseNumber(process.env["TTS_SPEED"], 1.0),
    },
    database: {
      path: process.env["DATABASE_PATH"] ?? "./data/birmel.db",
    },
    dailyPosts: {
      enabled: parseBoolean(process.env["DAILY_POSTS_ENABLED"], true),
      time: process.env["DAILY_POST_TIME"] ?? "09:00",
      timezone: process.env["DAILY_POST_TIMEZONE"] ?? "America/Los_Angeles",
    },
    voice: {
      enabled: parseBoolean(process.env["VOICE_ENABLED"], true),
      silenceThresholdMs: parseNumber(process.env["VOICE_SILENCE_THRESHOLD_MS"], 1500),
      maxRecordingMs: parseNumber(process.env["VOICE_MAX_RECORDING_MS"], 30000),
    },
    externalApis: {
      newsApiKey: process.env["NEWS_API_KEY"],
      riotApiKey: process.env["RIOT_API_KEY"],
    },
    logging: {
      level: process.env["LOG_LEVEL"] ?? "info",
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
