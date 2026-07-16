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

/**
 * Read every configuration value from the current environment.
 *
 * In production the environment is static, so this runs once (lazily, on first
 * property access) and is then memoized — behaviour identical to the previous
 * eager object literal. Tests can mutate `Bun.env` and call
 * {@link resetConfigurationForTests} to force a re-read, which is why the
 * values live behind getters instead of being snapshotted at import time.
 */
function computeConfiguration() {
  const config = {
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
    reportLakeDir: env
      .get("REPORT_LAKE_DIR")
      .default("./report-lake")
      .asString(),
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
  return config;
}

type Configuration = ReturnType<typeof computeConfiguration>;

let cachedConfiguration: Configuration | undefined;

function getConfiguration(): Configuration {
  cachedConfiguration ??= computeConfiguration();
  return cachedConfiguration;
}

/**
 * Clear the memoized configuration so the next access re-reads `Bun.env`.
 *
 * Test-only: production never mutates the environment after startup. Use this
 * from a test's `beforeEach`/`afterEach` when it needs to exercise a code path
 * gated on an env var (e.g. `S3_BUCKET_NAME` being unset).
 */
export function resetConfigurationForTests(): void {
  cachedConfiguration = undefined;
}

// Build the configuration lazily via getters. Each property delegates to the
// memoized snapshot, so consumers keep their existing `configuration.foo`
// property-access API while tests can force a re-read (see
// `resetConfigurationForTests`).
const configuration: Configuration = {
  get version() {
    return getConfiguration().version;
  },
  get gitSha() {
    return getConfiguration().gitSha;
  },
  get sentryDsn() {
    return getConfiguration().sentryDsn;
  },
  get environment() {
    return getConfiguration().environment;
  },
  get discordToken() {
    return getConfiguration().discordToken;
  },
  get applicationId() {
    return getConfiguration().applicationId;
  },
  get discordClientSecret() {
    return getConfiguration().discordClientSecret;
  },
  get jwtSigningSecret() {
    return getConfiguration().jwtSigningSecret;
  },
  get webAppOrigin() {
    return getConfiguration().webAppOrigin;
  },
  get feedbackUrl() {
    return getConfiguration().feedbackUrl;
  },
  get riotApiToken() {
    return getConfiguration().riotApiToken;
  },
  get databaseUrl() {
    return getConfiguration().databaseUrl;
  },
  get port() {
    return getConfiguration().port;
  },
  get s3BucketName() {
    return getConfiguration().s3BucketName;
  },
  get reportLakeDir() {
    return getConfiguration().reportLakeDir;
  },
  get reportDuckDbThreads() {
    return getConfiguration().reportDuckDbThreads;
  },
  get reportDuckDbMemoryLimit() {
    return getConfiguration().reportDuckDbMemoryLimit;
  },
  get openaiApiKey() {
    return getConfiguration().openaiApiKey;
  },
  get reportAiModel() {
    return getConfiguration().reportAiModel;
  },
  get geminiApiKey() {
    return getConfiguration().geminiApiKey;
  },
  get openaiHourlyTokenBudget() {
    return getConfiguration().openaiHourlyTokenBudget;
  },
  get openaiDailyTokenBudget() {
    return getConfiguration().openaiDailyTokenBudget;
  },
};

export default configuration;
