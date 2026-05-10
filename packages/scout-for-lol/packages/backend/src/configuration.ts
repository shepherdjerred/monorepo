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
  riotApiToken: getRequiredEnvVar("RIOT_API_KEY"),
  databaseUrl: getRequiredEnvVar("DATABASE_URL"),
  port: env.get("PORT").default("3000").asPortNumber(),
  s3BucketName: getOptionalEnvVar("S3_BUCKET_NAME"),
  openaiApiKey: getOptionalEnvVar("OPENAI_API_KEY"),
  geminiApiKey: getOptionalEnvVar("GEMINI_API_KEY"),
  openaiHourlyTokenBudget: env
    .get("OPENAI_HOURLY_TOKEN_BUDGET")
    .default("1000000")
    .asIntPositive(),
  openaiDailyTokenBudget: env
    .get("OPENAI_DAILY_TOKEN_BUDGET")
    .default("10000000")
    .asIntPositive(),
};

logger.info("✅ Configuration loaded successfully");
