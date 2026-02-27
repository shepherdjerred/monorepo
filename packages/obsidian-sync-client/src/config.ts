import { z } from "zod";

const ConfigSchema = z.object({
  token: z.string().min(1),
  vaultPassword: z.string().min(1),
  vaultName: z.string().min(1),
  vaultPath: z.string().min(1),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.output<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse({
    token: Bun.env["OBSIDIAN_TOKEN"],
    vaultPassword: Bun.env["OBSIDIAN_VAULT_PASSWORD"],
    vaultName: Bun.env["OBSIDIAN_VAULT_NAME"],
    vaultPath: Bun.env["VAULT_PATH"],
    logLevel: Bun.env["LOG_LEVEL"] ?? "info",
  });
}
