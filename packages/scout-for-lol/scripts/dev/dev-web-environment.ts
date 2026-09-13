export type DevAuthMode = "dev-login" | "oauth";

/**
 * `FEATURE_FLAGS_MODE=static` fails loudly (`FlagNotFoundError`) on any flag
 * key missing from `FEATURE_FLAGS_STATIC_OVERRIDES` — that is by design (see
 * `packages/feature-flags/CLAUDE.md`), so every key the backend can read
 * locally must be listed here or the read site throws. Values mirror each
 * flag's own registered default in
 * `packages/backend/src/configuration/flags.ts` (`FLAG_REGISTRY`), so a local
 * static-mode run behaves like a production Flipt outage rather than
 * inventing new local-only behavior. `scout-consumer-player-profiles-enabled`
 * is the one exception, flipped on to exercise the consumer preview this
 * script boots by default.
 */
export const DEFAULT_STATIC_FLAG_OVERRIDES: Record<
  string,
  boolean | string | number
> = {
  ai_reports_enabled: false,
  ai_reports_unlimited: false,
  ai_reviews_enabled: false,
  betting_enabled: false,
  betting_player_bet_outcome_dm_enabled: false,
  betting_settlement_dm_enabled: false,
  bucks_dares_enabled: false,
  bucks_transfers_enabled: false,
  challenge_runs_enabled: false,
  competition_builder_v2_enabled: false,
  custom_nights_enabled: false,
  dare_extended_contracts_enabled: false,
  dare_notifications_enabled: false,
  dare_v2: false,
  debug: false,
  duels_enabled: false,
  explore_creation_enabled: false,
  hall_of_fame_enabled: false,
  initial_match_history_import_enabled: false,
  scoutql_relational_enabled: false,
  "scout-consumer-player-profiles-enabled": true,
  "scout-temporal-call-graph-tracing": false,
  tournament_lobbies_enabled: false,
  voice_assistant_enabled: false,
  weekly_parlays_enabled: false,
  // Variant flags: same defaults as the `DEFINITION` snapshot in
  // packages/backend/src/config/dynamic.ts, which already falls back to them
  // gracefully on a refresh failure — listing them here just stops the noisy
  // "no static override" warning on every poll.
  "scout-betting-parlay-ai-model": "gpt-5.6-sol",
  "scout-explore-model": "gpt-5.6-luna",
  "scout-report-ai-model": "gpt-5.6-sol",
  "scout-tournament-api-mode": "stub",
  "scout-tournament-max-open-lobbies": 10,
  "llm-hourly-token-budget": 2_000_000,
  "llm-daily-token-budget": 20_000_000,
};

export type DevWebOptions = {
  readonly backendPort: number;
  readonly webPort: number;
  readonly temporalPort: number;
  readonly temporalUiPort: number;
  readonly databaseUrl: string;
  readonly discordGatewayEnabled: boolean;
  readonly backgroundJobsEnabled: boolean;
  readonly webEnabled: boolean;
  readonly backendWatchEnabled: boolean;
  readonly marketingOrigin: string;
  readonly docsOrigin: string;
  readonly authMode: DevAuthMode;
  readonly consumerPreview: boolean;
  readonly consumerGuildId: string | undefined;
};

export function devWebOrigins(options: DevWebOptions): {
  readonly backendOrigin: string;
  readonly webOrigin: string;
} {
  return {
    backendOrigin: `http://127.0.0.1:${options.backendPort.toString()}`,
    webOrigin: `http://localhost:${options.webPort.toString()}`,
  };
}

function parseBoolean(
  value: string | undefined,
  flag: string,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} must be true or false`);
}

function parseAuthMode(value: string): DevAuthMode {
  if (value === "dev-login" || value === "oauth") return value;
  throw new Error("SCOUT_DEV_AUTH_MODE must be dev-login or oauth");
}

function parseGuildId(value: string, flag: string): string {
  if (!/^\d{17,20}$/u.test(value)) {
    throw new Error(`${flag} must be a Discord guild id`);
  }
  return value;
}

export function parseConsumerOptions(
  environment: Readonly<Record<string, string | undefined>>,
  defaultGuildId: string,
): Pick<DevWebOptions, "authMode" | "consumerPreview" | "consumerGuildId"> {
  const authMode = parseAuthMode(
    environment["SCOUT_DEV_AUTH_MODE"] ?? "dev-login",
  );
  const consumerPreview = parseBoolean(
    environment["SCOUT_DEV_CONSUMER_PREVIEW"],
    "SCOUT_DEV_CONSUMER_PREVIEW",
    true,
  );
  const configuredConsumerGuildId = environment["SCOUT_DEV_CONSUMER_GUILD_ID"];
  const consumerGuildId = consumerPreview
    ? parseGuildId(
        configuredConsumerGuildId ?? defaultGuildId,
        "SCOUT_DEV_CONSUMER_GUILD_ID",
      )
    : configuredConsumerGuildId === undefined ||
        configuredConsumerGuildId === ""
      ? undefined
      : parseGuildId(configuredConsumerGuildId, "SCOUT_DEV_CONSUMER_GUILD_ID");

  return { authMode, consumerPreview, consumerGuildId };
}

export function buildDevEnvironment(
  baseEnvironment: Readonly<Record<string, string | undefined>>,
  options: DevWebOptions,
  lakeDir: string,
  isDesignAuditBoot: boolean,
): Record<string, string | undefined> {
  const previewGuildId = options.consumerPreview
    ? options.consumerGuildId
    : undefined;
  const featureFlagsMode =
    baseEnvironment["FEATURE_FLAGS_MODE"] ??
    (options.consumerPreview ? "static" : "disabled");
  const featureFlagsOverrides =
    baseEnvironment["FEATURE_FLAGS_STATIC_OVERRIDES"] ??
    (options.consumerPreview
      ? JSON.stringify(DEFAULT_STATIC_FLAG_OVERRIDES)
      : "{}");

  return {
    ...baseEnvironment,
    DATABASE_URL: options.databaseUrl,
    ENABLE_DEV_LOGIN: options.authMode === "dev-login" ? "true" : "false",
    DEV_AUTH_MODE: options.authMode,
    DEV_USER_GUILDS: baseEnvironment["DEV_USER_GUILDS"] ?? previewGuildId ?? "",
    EXPLORE_GUILD_ALLOWLIST:
      baseEnvironment["EXPLORE_GUILD_ALLOWLIST"] ?? previewGuildId ?? "",
    FEATURE_FLAGS_MODE: featureFlagsMode,
    FEATURE_FLAGS_STATIC_OVERRIDES: featureFlagsOverrides,
    PORT: options.backendPort.toString(),
    SCOUT_DEV_BACKEND_URL: `http://127.0.0.1:${options.backendPort.toString()}`,
    SCOUT_DEV_WEB_ORIGIN: `http://localhost:${options.webPort.toString()}`,
    VITE_MARKETING_ORIGIN: options.marketingOrigin,
    VITE_DOCS_ORIGIN: options.docsOrigin,
    // The backend picks its shape from one role rather than two booleans. A
    // local instance that does not own the single BETA gateway runs the same
    // `application` role the split deployment will: web surface, interactive
    // and lake workers, report lake, no shard.
    SCOUT_RUNTIME_ROLE:
      isDesignAuditBoot || !options.discordGatewayEnabled
        ? "application"
        : "combined",
    // Narrower than the ENABLE_BACKGROUND_JOBS flag this replaces: it skips only
    // the boot-time lake fold, which is the step a laptop with no published
    // build and no S3 bucket cannot complete. Which workers run is the role's
    // decision now, not this flag's.
    SCOUT_DEV_SKIP_REPORT_LAKE_FOLD:
      isDesignAuditBoot ||
      !options.discordGatewayEnabled ||
      !options.backgroundJobsEnabled
        ? "true"
        : "false",
    WEB_APP_ORIGIN: `http://localhost:${options.webPort.toString()}`,
    REPORT_LAKE_DIR: lakeDir,
    ...(isDesignAuditBoot
      ? {
          GIT_SHA: "0000000000000000000000000000000000000000",
          NODE_ENV: "test",
        }
      : {}),
  };
}
