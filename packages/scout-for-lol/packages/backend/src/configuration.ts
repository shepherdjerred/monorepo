import "dotenv/config";
import env from "env-var";
import { z } from "zod";
import { createLogger } from "#src/logger.ts";
import {
  DEFAULT_EXPLORE_QUOTA_LIMITS,
  ExploreQuotaLimitsInputSchema,
} from "#src/configuration/explore-quota.ts";
import {
  parseScoutRuntimeRole,
  scoutRuntimeCapabilities,
} from "#src/configuration/runtime-role.ts";
import { ScoutStageSchema } from "@scout-for-lol/temporal";

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

/**
 * The "Hey Scout" voice assistant's environment surface — credentials and
 * bootstrap only, per the repo's configuration policy.
 *
 * There is deliberately no `enabled` flag here. Activation is the
 * `voice_assistant_enabled` Flipt flag and nothing else: it already decides
 * whether `/scout join` may open a session and tears down live sessions when
 * it flips off, so a second env gate duplicated that authority without adding
 * any. What used to justify the env var — model verification being fatal at
 * boot — no longer applies: the models load lazily on first use
 * (`voice-assistant/runtime.ts`), and the image's `voice-smoke` build stage
 * proves they load before the image can be published, which catches a broken
 * asset set earlier than a crash-looping pod did.
 *
 * The credential can arrive directly for local development or through a
 * mounted Secret file in Kubernetes. Both stay optional: their absence is a
 * runtime answer ("voice is not configured in this deployment"), not a boot
 * failure, so a deployment that never intends to serve voice simply omits
 * them.
 */
export const VoiceAssistantConfigSchema = z.object({
  openAiApiKey: z.string().min(1).optional(),
  openAiApiKeyFile: z.string().min(1).optional(),
  assetsDir: z.string().min(1).default("/opt/scout/voice"),
  kwsRuntime: z.enum(["auto", "native", "wasm"]).default("auto"),
});

export type VoiceAssistantConfig = z.infer<typeof VoiceAssistantConfigSchema>;

/**
 * Parse the voice assistant's environment surface. Values are optional strings
 * where empty means absent. A present but invalid `kwsRuntime` throws here
 * rather than falling back.
 */
export function parseVoiceAssistantConfiguration(values: {
  openAiApiKey: string | undefined;
  openAiApiKeyFile: string | undefined;
  assetsDir: string | undefined;
  kwsRuntime: string | undefined;
}): VoiceAssistantConfig {
  return VoiceAssistantConfigSchema.parse({
    ...(values.openAiApiKey === undefined
      ? {}
      : { openAiApiKey: values.openAiApiKey }),
    ...(values.openAiApiKeyFile === undefined
      ? {}
      : { openAiApiKeyFile: values.openAiApiKeyFile }),
    ...(values.assetsDir === undefined ? {} : { assetsDir: values.assetsDir }),
    ...(values.kwsRuntime === undefined
      ? {}
      : { kwsRuntime: values.kwsRuntime }),
  });
}

const TemporalScheduleReconciliationSchema = z.enum([
  "enabled",
  "disabled",
  "auto",
]);
export type TemporalScheduleReconciliation = z.infer<
  typeof TemporalScheduleReconciliationSchema
>;

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
  // Which shape of the one backend image this process is. Bootstrap config by
  // definition: it decides what starts, so it cannot come from a flag service
  // the process has not connected to yet.
  const runtimeRole = parseScoutRuntimeRole(
    env.get("SCOUT_RUNTIME_ROLE").asString(),
  );
  // Local-only escape hatch for the boot-time report-lake fold, which is the
  // one startup step a developer routinely cannot satisfy: with no published
  // build and no S3 bucket the fold falls back to a rebuild and throws. It is
  // deliberately narrower than the ENABLE_BACKGROUND_JOBS flag it replaces —
  // that one also silently removed the realtime, background and competition
  // workers, which is a capability decision and now belongs to the role.
  const skipReportLakeFold = env
    .get("SCOUT_DEV_SKIP_REPORT_LAKE_FOLD")
    .default("false")
    .asBool();
  if (environment !== "dev" && skipReportLakeFold) {
    throw new Error(
      "SCOUT_DEV_SKIP_REPORT_LAKE_FOLD may only be set in environment=dev: a beta/prod pod that owns the report lake must publish a build before it serves from it",
    );
  }
  const temporalNamespace = ScoutStageSchema.parse(
    env.get("TEMPORAL_NAMESPACE").required().asString(),
  );
  const temporalScheduleReconciliation =
    TemporalScheduleReconciliationSchema.parse(
      getOptionalEnvVar("TEMPORAL_SCHEDULE_RECONCILIATION", "enabled"),
    );
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
    // (set only by scripts/dev/dev-web.ts) means an omitted config fails closed.
    enableDevLogin: env.get("ENABLE_DEV_LOGIN").default("false").asBool(),
    // Local web boots use the signed dev-login route by default so a secondary
    // copy does not depend on a Discord Developer Portal callback registration.
    // Production and Beta retain OAuth unless a local script explicitly opts
    // into dev-login.
    devAuthMode: env
      .get("DEV_AUTH_MODE")
      .default("oauth")
      .asEnum(["dev-login", "oauth"]),
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
    // A secondary local web instance opts out of the single BETA Discord
    // gateway by running the `application` role instead of `combined`.
    runtimeRole,
    // Derived, not read from the environment: the role decides the subsystems,
    // so a consumer asking "may this process do X" asks the table rather than
    // re-deriving X from a role name at the call site.
    runtimeCapabilities: scoutRuntimeCapabilities(runtimeRole),
    skipReportLakeFold,
    temporalAddress: getOptionalEnvVar("TEMPORAL_ADDRESS"),
    temporalNamespace,
    temporalScheduleReconciliation,
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
    inferenceConfigured: getOptionalEnvVar("OPENAI_API_KEY") !== undefined,
    reportAiModel: getOptionalEnvVar("REPORT_AI_MODEL", "gpt-5.6-sol"),
    bettingParlayAiModel: getOptionalEnvVar(
      "BETTING_PARLAY_AI_MODEL",
      "gpt-5.6-sol",
    ),
    // Bearer credential for the internal Bryan Bucks analytics control route
    // the Temporal analytics Schedule calls. Absent in deployments that do not
    // expose that route.
    bryanBucksControlToken: getOptionalEnvVar("BRYAN_BUCKS_CONTROL_TOKEN"),
    exploreModel: env.get("EXPLORE_MODEL").default("gpt-5.6-luna").asString(),
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
    // Seeds the dynamic-config snapshot, so a read before the first flag
    // refresh matches the env layer. Unset means the shipped policy.
    exploreQuotaLimits: ExploreQuotaLimitsInputSchema.parse(
      env
        .get("EXPLORE_QUOTA_LIMITS")
        .default(JSON.stringify(DEFAULT_EXPLORE_QUOTA_LIMITS))
        .asString(),
    ),
    // env-var's asIntPositive admits zero, which matters here: 0 silences
    // tips without removing the feature.
    featureTipPercent: env
      .get("FEATURE_TIP_PERCENT")
      .default("10")
      .asIntPositive(),
    featureTipCooldownHours: env
      .get("FEATURE_TIP_COOLDOWN_HOURS")
      .default("72")
      .asIntPositive(),
    voiceAssistant: parseVoiceAssistantConfiguration({
      openAiApiKey: getOptionalEnvVar("OPENAI_API_KEY"),
      openAiApiKeyFile: getOptionalEnvVar("OPENAI_API_KEY_FILE"),
      assetsDir: getOptionalEnvVar("VOICE_ASSETS_DIR"),
      kwsRuntime: getOptionalEnvVar("VOICE_KWS_RUNTIME"),
    }),
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
  get devAuthMode() {
    return getConfiguration().devAuthMode;
  },
  get devUserGuilds() {
    return getConfiguration().devUserGuilds;
  },
  get runtimeRole() {
    return getConfiguration().runtimeRole;
  },
  get runtimeCapabilities() {
    return getConfiguration().runtimeCapabilities;
  },
  get skipReportLakeFold() {
    return getConfiguration().skipReportLakeFold;
  },
  get temporalAddress() {
    return getConfiguration().temporalAddress;
  },
  get temporalNamespace() {
    const current = getConfiguration();
    if (current.temporalNamespace !== current.environment) {
      throw new Error(
        `TEMPORAL_NAMESPACE=${current.temporalNamespace} must match ENVIRONMENT=${current.environment}`,
      );
    }
    return current.temporalNamespace;
  },
  get temporalScheduleReconciliation() {
    return getConfiguration().temporalScheduleReconciliation;
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
  get inferenceConfigured() {
    return getConfiguration().inferenceConfigured;
  },
  get reportAiModel() {
    return getConfiguration().reportAiModel;
  },
  get bettingParlayAiModel() {
    return getConfiguration().bettingParlayAiModel;
  },
  get bryanBucksControlToken() {
    return getConfiguration().bryanBucksControlToken;
  },
  get exploreModel() {
    return getConfiguration().exploreModel;
  },
  get exploreGuildAllowlist() {
    return getConfiguration().exploreGuildAllowlist;
  },
  get llmHourlyTokenBudget() {
    return getConfiguration().llmHourlyTokenBudget;
  },
  get exploreQuotaLimits() {
    return getConfiguration().exploreQuotaLimits;
  },
  get llmDailyTokenBudget() {
    return getConfiguration().llmDailyTokenBudget;
  },
  get featureTipPercent() {
    return getConfiguration().featureTipPercent;
  },
  get featureTipCooldownHours() {
    return getConfiguration().featureTipCooldownHours;
  },
  get voiceAssistant() {
    return getConfiguration().voiceAssistant;
  },
};

export default configuration;
