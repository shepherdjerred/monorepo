import { configSchema, type Config } from "./schema.js";

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = configSchema.safeParse({
    anthropic: {
      apiKey: process.env["ANTHROPIC_API_KEY"],
      model: process.env["ANTHROPIC_MODEL"],
    },
    server: {
      port: process.env["PORT"],
    },
    logLevel: process.env["LOG_LEVEL"],
  });

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export type { Config };
