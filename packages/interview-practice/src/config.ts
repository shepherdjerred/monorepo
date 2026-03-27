import { z } from "zod/v4";
import { join } from "node:path";
import { homedir } from "node:os";

const AiProviderSchema = z.enum(["anthropic", "openai", "google"]);

const ConfigSchema = z.object({
  aiProvider: AiProviderSchema,
  anthropicApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  googleApiKey: z.string().optional(),
  conversationModel: z.string().optional(),
  realtimeModel: z.string(),
  realtimeVoice: z.string(),
  leetcodeTimeMinutes: z.number().int().min(1),
  systemDesignTimeMinutes: z.number().int().min(1),
  transcriptWindowSize: z.number().int().min(1),
  dataDir: z.string(),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
  excalidrawPort: z.number().int(),
  excalidrawImage: z.string(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AiProvider = z.infer<typeof AiProviderSchema>;

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6-20260217",
  openai: "gpt-5.4-mini",
  google: "gemini-3.1-flash-lite",
};

function resolveDataDir(envValue: string | undefined): string {
  const raw = envValue ?? "~/.interview-practice";
  if (raw.startsWith("~")) {
    return join(homedir(), raw.slice(1));
  }
  return raw;
}

export function loadConfig(): Config {
  const provider = (process.env["AI_PROVIDER"] ?? "anthropic");
  const dataDir = resolveDataDir(process.env["DATA_DIR"]);

  return ConfigSchema.parse({
    aiProvider: provider,
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
    openaiApiKey: process.env["OPENAI_API_KEY"],
    googleApiKey: process.env["GOOGLE_API_KEY"],
    conversationModel:
      process.env["CONVERSATION_MODEL"] ?? DEFAULT_MODELS[provider],
    realtimeModel: process.env["REALTIME_MODEL"] ?? "gpt-realtime-mini",
    realtimeVoice: process.env["REALTIME_VOICE"] ?? "ash",
    leetcodeTimeMinutes: Number.parseInt(
      process.env["LEETCODE_TIME_MINUTES"] ?? "25",
      10,
    ),
    systemDesignTimeMinutes: Number.parseInt(
      process.env["SYSTEM_DESIGN_TIME_MINUTES"] ?? "45",
      10,
    ),
    transcriptWindowSize: Number.parseInt(
      process.env["TRANSCRIPT_WINDOW_SIZE"] ?? "20",
      10,
    ),
    dataDir,
    logLevel: process.env["LOG_LEVEL"] ?? "info",
    excalidrawPort: Number.parseInt(
      process.env["EXCALIDRAW_PORT"] ?? "8080",
      10,
    ),
    excalidrawImage:
      process.env["EXCALIDRAW_IMAGE"] ?? "excalidraw/excalidraw:latest",
  });
}
