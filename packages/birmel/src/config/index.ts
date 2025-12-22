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
