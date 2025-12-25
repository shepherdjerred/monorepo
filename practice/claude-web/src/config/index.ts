import { configSchema, type Config } from "./schema.js";

let config: Config | null = null;

export function getConfig(): Config {
  if (!config) {
    const result = configSchema.safeParse(process.env);

    if (!result.success) {
      console.error("Invalid configuration:");
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }

    config = result.data;
  }

  return config;
}

export { type Config } from "./schema.js";
