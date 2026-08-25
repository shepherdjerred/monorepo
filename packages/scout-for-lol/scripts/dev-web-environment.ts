export type DevAuthMode = "dev-login" | "oauth";

export type DevWebOptions = {
  readonly backendPort: number;
  readonly webPort: number;
  readonly databaseUrl: string;
  readonly discordGatewayEnabled: boolean;
  readonly backendWatchEnabled: boolean;
  readonly marketingOrigin: string;
  readonly docsOrigin: string;
  readonly authMode: DevAuthMode;
  readonly consumerPreview: boolean;
  readonly consumerGuildId: string | undefined;
};

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
      ? '{"scout-consumer-player-profiles-enabled":true}'
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
    ENABLE_BACKGROUND_JOBS:
      isDesignAuditBoot || !options.discordGatewayEnabled ? "false" : "true",
    ENABLE_DISCORD_GATEWAY:
      isDesignAuditBoot || !options.discordGatewayEnabled ? "false" : "true",
    WEB_APP_ORIGIN: `http://localhost:${options.webPort.toString()}`,
    REPORT_LAKE_DIR: lakeDir,
    ...(isDesignAuditBoot ? { NODE_ENV: "test" } : {}),
  };
}
