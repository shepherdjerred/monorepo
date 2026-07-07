import "dotenv/config";
import env from "env-var";
import { z } from "zod";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("config");

logger.info("🔧 Loading application configuration");

function getRequiredEnvVar(name: string): string {
  // don't require these when running tests
  if (Bun.env.NODE_ENV === "test") {
    return getOptionalEnvVar(name) ?? "TEST PLACEHOLDER";
  }
  try {
    const value = env.get(name).required().asString();
    logger.info(`✅ ${name}: configured`);
    return value;
  } catch (error) {
    logger.error(`❌ Missing required environment variable: ${name}`);
    throw error;
  }
}

function getOptionalEnvVar(
  name: string,
  defaultValue?: string,
): string | undefined {
  const value = env.get(name).asString();
  if (value !== undefined && value.length > 0) {
    logger.info(`✅ ${name}: configured`);
    return value;
  } else if (defaultValue !== undefined && defaultValue.length > 0) {
    logger.info(`⚠️  ${name}: using default value (${defaultValue})`);
    return defaultValue;
  } else {
    logger.info(`⚠️  ${name}: not configured`);
    return undefined;
  }
}

const EnvironmentSchema = z.enum(["dev", "beta", "prod"]);

export function resolveEnvironment(): z.infer<typeof EnvironmentSchema> {
  const raw = env.get("ENVIRONMENT").default("dev").asString();
  const parsed = EnvironmentSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error(
    `Invalid ENVIRONMENT="${raw}", expected one of: dev, beta, prod`,
  );
}

export default {
  version: getRequiredEnvVar("VERSION"),
  gitSha: getRequiredEnvVar("GIT_SHA"),
  sentryDsn: getOptionalEnvVar("SENTRY_DSN"),
  environment: resolveEnvironment(),
  discordToken: getRequiredEnvVar("DISCORD_TOKEN"),
  applicationId: getRequiredEnvVar("APPLICATION_ID"),
  discordClientSecret: getOptionalEnvVar("DISCORD_CLIENT_SECRET"),
  jwtSigningSecret: getOptionalEnvVar("JWT_SIGNING_SECRET"),
  webAppOrigin: getOptionalEnvVar(
    "WEB_APP_ORIGIN",
    "https://scout-for-lol.com",
  ),
  // Where owners are pointed to leave feedback when the bot is removed from
  // their server. Defaults to the marketing site; override to a dedicated form.
  feedbackUrl: getOptionalEnvVar("FEEDBACK_URL", "https://scout-for-lol.com"),
  riotApiToken: getRequiredEnvVar("RIOT_API_KEY"),
  databaseUrl: getRequiredEnvVar("DATABASE_URL"),
  port: env.get("PORT").default("3000").asPortNumber(),
  s3BucketName: getOptionalEnvVar("S3_BUCKET_NAME"),
  // Local Parquet "report lake" queried by the DuckDB report engine.
  // Disposable derived data: rebuilt from the Stored* tables by the
  // report-lake compaction crons.
  reportLakeDir: env.get("REPORT_LAKE_DIR").default("./report-lake").asString(),
  reportDuckDbThreads: env
    .get("REPORT_DUCKDB_THREADS")
    .default("2")
    .asIntPositive(),
  reportDuckDbMemoryLimit: env
    .get("REPORT_DUCKDB_MEMORY_LIMIT")
    .default("512MB")
    .asString(),
  openaiApiKey: getOptionalEnvVar("OPENAI_API_KEY"),
  reportAiModel: getOptionalEnvVar("REPORT_AI_MODEL", "openai/gpt-5.5"),
  geminiApiKey: getOptionalEnvVar("GEMINI_API_KEY"),
  openaiHourlyTokenBudget: env
    .get("OPENAI_HOURLY_TOKEN_BUDGET")
    .default("2000000")
    .asIntPositive(),
  openaiDailyTokenBudget: env
    .get("OPENAI_DAILY_TOKEN_BUDGET")
    .default("20000000")
    .asIntPositive(),
};

logger.info("✅ Configuration loaded successfully");
