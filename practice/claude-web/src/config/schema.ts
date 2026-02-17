import { z } from "zod";

export const configSchema = z.object({
  // Server
  PORT: z.coerce.number().default(8000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Required secrets
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  GITHUB_CLIENT_ID: z.string().min(1, "GITHUB_CLIENT_ID is required"),
  GITHUB_CLIENT_SECRET: z.string().min(1, "GITHUB_CLIENT_SECRET is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

  // Database
  DATABASE_URL: z.string().default("file:./dev.db"),

  // Container limits
  CONTAINER_MEMORY_LIMIT: z.string().default("2g"),
  CONTAINER_CPU_SHARES: z.coerce.number().default(512),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().default(30),
  SESSION_MAX_DURATION_HOURS: z.coerce.number().default(8),

  // Frontend
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
});

export type Config = z.infer<typeof configSchema>;
