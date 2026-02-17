import { z } from "zod";

export const configSchema = z.object({
  anthropic: z.object({
    apiKey: z.string().min(1, "ANTHROPIC_API_KEY is required"),
    model: z.string().default("claude-sonnet-4-20250514"),
  }),
  server: z.object({
    port: z.coerce.number().int().positive().default(8000),
  }),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof configSchema>;
