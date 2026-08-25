import "dotenv/config";
import env from "env-var";
import { z } from "zod";
import { createLogger } from "#src/logger.ts";
import { TournamentApiModeSchema } from "#src/configuration/tournament-mode.ts";

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
export type Environment = z.infer<typeof EnvironmentSchema>;

const ProductAnalyticsConfigurationSchema = z.object({
  projectToken: z.string().min(1),
  apiHost: z.url(),
  siteKey: z.string().min(1),
  siteHostname: z.string().min(1),
});

export type ProductAnalyticsConfiguration = z.infer<
  typeof ProductAnalyticsConfigurationSchema
>;

export function resolveEnvironment(): Environment {
  const raw = env.get("ENVIRONMENT").default("dev").asString();
  const parsed = EnvironmentSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error(
    `Invalid ENVIRONMENT="${raw}", expected one of: dev, beta, prod`,
  );
}

export function parseProductAnalyticsConfiguration(
  environment: Environment,
  values: {
    projectToken: string | undefined;
    apiHost: string | undefined;
    siteKey: string | undefined;
    siteHostname: string | undefined;
  },
): ProductAnalyticsConfiguration | undefined {
  if (environment === "dev") {
    return undefined;
  }

  const parsed = ProductAnalyticsConfigurationSchema.safeParse(values);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(
    `Complete PostHog configuration is required in ${environment}: POSTHOG_PROJECT_TOKEN, POSTHOG_API_HOST, POSTHOG_SITE_KEY, POSTHOG_SITE_HOSTNAME`,
    { cause: parsed.error },
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
  const environment = resolveEnvironment();
  const enableDiscordGateway = env
    .get("ENABLE_DISCORD_GATEWAY")
    .default("true")
    .asBool();
  const enableBackgroundJobs = env
    .get("ENABLE_BACKGROUND_JOBS")
    .default("true")
    .asBool();
  if (
    environment !== "dev" &&
    (!enableDiscordGateway || !enableBackgroundJobs)
  ) {
    throw new Error(
      "ENABLE_DISCORD_GATEWAY and ENABLE_BACKGROUND_JOBS may only be disabled in environment=dev",
    );
  }
  if (enableBackgroundJobs && !enableDiscordGateway) {
    throw new Error(
      "ENABLE_BACKGROUND_JOBS requires ENABLE_DISCORD_GATEWAY: background jobs use the Discord client and guild filtering",
    );
  }
  const config = {
    version: getRequiredEnvVar("VERSION"),
    gitSha: getRequiredEnvVar("GIT_SHA"),
    // Hash of the tRPC contract sources, baked into the image (see
    // packages/scout-for-lol/scripts/contract-hash.ts). Served by
    // /api/version; the SPA compares it against its own baked hash.
    contractHash: getRequiredEnvVar("CONTRACT_HASH"),
    sentryDsn: getOptionalEnvVar("SENTRY_DSN"),
    environment,
    productAnalytics:
      Bun.env.NODE_ENV === "test"
        ? undefined
        : parseProductAnalyticsConfiguration(environment, {
            projectToken: getOptionalEnvVar("POSTHOG_PROJECT_TOKEN"),
            apiHost: getOptionalEnvVar("POSTHOG_API_HOST"),
            siteKey: getOptionalEnvVar("POSTHOG_SITE_KEY"),
            siteHostname: getOptionalEnvVar("POSTHOG_SITE_HOSTNAME"),
          }),
    // Separate, default-off opt-in for the dev-only instant-login route
    // (/api/dev/login). `environment` defaults to "dev" when ENVIRONMENT is
    // unset, so gating the route on `environment === "dev"` alone would fail
    // open on a beta/prod deploy that forgot to set ENVIRONMENT — an
    // unauthenticated session-minting endpoint. Requiring this explicit flag
    // (set only by scripts/dev-web.ts) means an omitted config fails closed.
    enableDevLogin: env.get("ENABLE_DEV_LOGIN").default("false").asBool(),
    // Dev-only stand-in for the caller's Discord server membership. A
    // dev-login session carries no Discord OAuth token, so anything that
    // resolves guilds — the guild picker, assertGuildAdmin, and explore's
    // allowlist check — cannot answer for it, which leaves explore
    // unreachable without a real OAuth click-through. Listing server ids here
    // answers those lookups locally instead.
    //
    // Carries no gate of its own: it is honoured only alongside
    // `enableDevLogin` in `environment === "dev"` (see devGuildOverride), the
    // same pair that already binds the server to loopback. Unset means "no
    // override", so an omitted config fails closed exactly like dev-login.
    devUserGuilds: env.get("DEV_USER_GUILDS").default("").asArray(","),
    // A secondary local web instance can opt out of the single BETA Discord
    // gateway and background jobs. These remain enabled by default everywhere.
    enableDiscordGateway,
    enableBackgroundJobs,
    temporalAddress: getOptionalEnvVar("TEMPORAL_ADDRESS"),
    temporalNamespace: env
      .get("TEMPORAL_NAMESPACE")
      .default("default")
      .asString(),
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
    openRouterApiKey: getOptionalEnvVar("OPENROUTER_API_KEY"),
    reportAiModel: getOptionalEnvVar("REPORT_AI_MODEL", "gpt-5.6-sol"),
    bettingParlayAiModel: getOptionalEnvVar(
      "BETTING_PARLAY_AI_MODEL",
      "gpt-5.6-sol",
    ),
    // Bootstrap credential for Temporal's private weekly-parlay control
    // endpoint. When absent, the route is not registered at all.
    weeklyParlayControlToken: getOptionalEnvVar("WEEKLY_PARLAY_CONTROL_TOKEN"),
    exploreModel: env.get("EXPLORE_MODEL").default("gpt-5.6-luna").asString(),
    bucksAskModel: env.get("BB_ASK_MODEL").default("gpt-5.6-luna").asString(),
    // Beta Explore access is an explicit Discord server allowlist. Production
    // authorizes against the bot's live connected-guild set instead. Unset
    // still means nobody in beta.
    exploreGuildAllowlist: env
      .get("EXPLORE_GUILD_ALLOWLIST")
      .default("")
      .asArray(","),
    llmHourlyTokenBudget: env
      .get("LLM_HOURLY_TOKEN_BUDGET")
      .default("2000000")
      .asIntPositive(),
    llmDailyTokenBudget: env
      .get("LLM_DAILY_TOKEN_BUDGET")
      .default("20000000")
      .asIntPositive(),
    // Seeds the dynamic-config snapshot so a read before the first flag
    // refresh matches the env layer. "stub" is the safe default: stub codes
    // cannot create a real game.
    tournamentApiMode: TournamentApiModeSchema.parse(
      env.get("TOURNAMENT_API_MODE").default("stub").asString(),
    ),
    tournamentMaxOpenLobbies: env
      .get("TOURNAMENT_MAX_OPEN_LOBBIES")
      .default("10")
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
  get contractHash() {
    return getConfiguration().contractHash;
  },
  get sentryDsn() {
    return getConfiguration().sentryDsn;
  },
  get environment() {
    return getConfiguration().environment;
  },
  get productAnalytics() {
    return getConfiguration().productAnalytics;
  },
  get enableDevLogin() {
    return getConfiguration().enableDevLogin;
  },
  get devUserGuilds() {
    return getConfiguration().devUserGuilds;
  },
  get enableDiscordGateway() {
    return getConfiguration().enableDiscordGateway;
  },
  get enableBackgroundJobs() {
    return getConfiguration().enableBackgroundJobs;
  },
  get temporalAddress() {
    return getConfiguration().temporalAddress;
  },
  get temporalNamespace() {
    return getConfiguration().temporalNamespace;
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
  get openRouterApiKey() {
    return getConfiguration().openRouterApiKey;
  },
  get reportAiModel() {
    return getConfiguration().reportAiModel;
  },
  get bettingParlayAiModel() {
    return getConfiguration().bettingParlayAiModel;
  },
  get weeklyParlayControlToken() {
    return getConfiguration().weeklyParlayControlToken;
  },
  get exploreModel() {
    return getConfiguration().exploreModel;
  },
  get bucksAskModel() {
    return getConfiguration().bucksAskModel;
  },
  get exploreGuildAllowlist() {
    return getConfiguration().exploreGuildAllowlist;
  },
  get llmHourlyTokenBudget() {
    return getConfiguration().llmHourlyTokenBudget;
  },
  get llmDailyTokenBudget() {
    return getConfiguration().llmDailyTokenBudget;
  },
  get tournamentApiMode() {
    return getConfiguration().tournamentApiMode;
  },
  get tournamentMaxOpenLobbies() {
    return getConfiguration().tournamentMaxOpenLobbies;
  },
};

export default configuration;
