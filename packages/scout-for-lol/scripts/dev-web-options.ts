import {
  parseConsumerOptions,
  type DevWebOptions,
} from "./dev-web-environment.ts";
import { parseDevOrigin } from "./dev-origin.ts";
import { requireCliValue } from "./migration-core.ts";

const DEFAULT_BACKEND_PORT = 3000;
const DEFAULT_WEB_PORT = 5180;
const TEMPORAL_PORT_OFFSET = 4233;
const TEMPORAL_UI_PORT_OFFSET = 5233;
const DEFAULT_PG_PORT = "5471";
const DEFAULT_DESIGN_AUDIT_DATABASE_NAME = "scout_design_audit";
const DEFAULT_CONSUMER_GUILD_ID = "1337623164146155593";

export type DevWebParseResult =
  | { readonly kind: "help" }
  | { readonly kind: "options"; readonly options: DevWebOptions };

type CliOverrides = {
  readonly backendPort: number | undefined;
  readonly webPort: number | undefined;
  readonly databaseUrl: string | undefined;
  readonly temporalPort: number | undefined;
  readonly temporalUiPort: number | undefined;
  readonly discordGatewayEnabled: boolean | undefined;
  readonly backendWatchEnabled: boolean | undefined;
  readonly marketingOrigin: string | undefined;
  readonly docsOrigin: string | undefined;
};

function parsePort(value: string, flag: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${flag} must be an integer between 1 and 65535`);
  }
  return port;
}

function parseDatabaseUrl(value: string): string {
  if (!value.startsWith("postgres://") && !value.startsWith("postgresql://")) {
    throw new Error(
      "--database-url must be a postgres:// URL (SQLite is no longer supported)",
    );
  }
  return value;
}

function sharedServerUrl(
  backendPort: number,
  environment: Readonly<Record<string, string | undefined>>,
  databaseName = `scout_dev_${backendPort.toString()}`,
): string {
  const pgPort = environment["SCOUT_PG_PORT"] ?? DEFAULT_PG_PORT;
  return `postgres://scout@127.0.0.1:${pgPort}/${databaseName}`;
}

/**
 * When the resolved URL targets the shared local dev server, return the
 * database name so the boot path can ensure server + database exist.
 * External URLs (e.g. a restored beta snapshot database) return undefined
 * and are used as-is.
 */
export function sharedServerDatabaseName(
  databaseUrl: string,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const pgPort = environment["SCOUT_PG_PORT"] ?? DEFAULT_PG_PORT;
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return undefined;
  }
  const isLoopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!isLoopback || parsed.port !== pgPort) return undefined;
  const dbName = parsed.pathname.replace(/^\//, "");
  return /^[a-z][a-z0-9_]*$/.test(dbName) ? dbName : undefined;
}

function defaultDatabaseUrl(
  backendPort: number,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (environment["SCOUT_DESIGN_AUDIT_LOCAL_BOOT"] === "true") {
    return sharedServerUrl(
      backendPort,
      environment,
      DEFAULT_DESIGN_AUDIT_DATABASE_NAME,
    );
  }
  const configured = environment["SCOUT_DEV_DATABASE_URL"];
  if (configured !== undefined) return parseDatabaseUrl(configured);

  const inherited = environment["DATABASE_URL"];
  if (
    backendPort === DEFAULT_BACKEND_PORT &&
    inherited !== undefined &&
    inherited.length > 0
  ) {
    return parseDatabaseUrl(inherited);
  }
  return sharedServerUrl(backendPort, environment);
}

const valueOptions = new Set([
  "--backend-port",
  "--web-port",
  "--database-url",
  "--temporal-port",
  "--temporal-ui-port",
  "--marketing-origin",
  "--docs-origin",
]);

function parseOptionalValue<T>(
  values: ReadonlyMap<string, string>,
  option: string,
  parse: (value: string) => T,
): T | undefined {
  const value = values.get(option);
  return value === undefined ? undefined : parse(value);
}

function parseCliOverrides(args: readonly string[]): CliOverrides | undefined {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return undefined;
    if (
      argument === "--no-discord-gateway" ||
      argument === "--no-backend-watch"
    ) {
      flags.add(argument);
      continue;
    }
    if (argument === undefined || !valueOptions.has(argument)) {
      throw new Error(`Unknown argument: ${argument ?? "<missing>"}`);
    }
    values.set(argument, requireCliValue(args, index, argument));
    index += 1;
  }
  return {
    backendPort: parseOptionalValue(values, "--backend-port", (value) =>
      parsePort(value, "--backend-port"),
    ),
    webPort: parseOptionalValue(values, "--web-port", (value) =>
      parsePort(value, "--web-port"),
    ),
    databaseUrl: parseOptionalValue(values, "--database-url", parseDatabaseUrl),
    temporalPort: parseOptionalValue(values, "--temporal-port", (value) =>
      parsePort(value, "--temporal-port"),
    ),
    temporalUiPort: parseOptionalValue(values, "--temporal-ui-port", (value) =>
      parsePort(value, "--temporal-ui-port"),
    ),
    discordGatewayEnabled: flags.has("--no-discord-gateway")
      ? false
      : undefined,
    backendWatchEnabled: flags.has("--no-backend-watch") ? false : undefined,
    marketingOrigin: parseOptionalValue(values, "--marketing-origin", (value) =>
      parseDevOrigin(value, "--marketing-origin"),
    ),
    docsOrigin: parseOptionalValue(values, "--docs-origin", (value) =>
      parseDevOrigin(value, "--docs-origin"),
    ),
  };
}

function configuredPort(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
): number {
  return parsePort(environment[key] ?? fallback.toString(), key);
}

function optionalConfiguredPort(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): number | undefined {
  const value = environment[key];
  return value === undefined ? undefined : parsePort(value, key);
}

export function parseDevWebArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): DevWebParseResult {
  const cli = parseCliOverrides(args);
  if (cli === undefined) return { kind: "help" };
  const backendPort =
    cli.backendPort ??
    configuredPort(environment, "SCOUT_DEV_BACKEND_PORT", DEFAULT_BACKEND_PORT);
  const webPort =
    cli.webPort ??
    configuredPort(environment, "SCOUT_DEV_WEB_PORT", DEFAULT_WEB_PORT);
  const temporalPort =
    cli.temporalPort ??
    optionalConfiguredPort(environment, "SCOUT_DEV_TEMPORAL_PORT");
  const temporalUiPort =
    cli.temporalUiPort ??
    optionalConfiguredPort(environment, "SCOUT_DEV_TEMPORAL_UI_PORT");
  const resolvedTemporalPort =
    temporalPort ??
    parsePort(
      (backendPort + TEMPORAL_PORT_OFFSET).toString(),
      "derived Temporal port",
    );
  const resolvedTemporalUiPort =
    temporalUiPort ??
    parsePort(
      (backendPort + TEMPORAL_UI_PORT_OFFSET).toString(),
      "derived Temporal UI port",
    );
  if (
    new Set([
      backendPort,
      webPort,
      resolvedTemporalPort,
      resolvedTemporalUiPort,
    ]).size !== 4
  ) {
    throw new Error(
      "--backend-port, --web-port, --temporal-port, and --temporal-ui-port must be different",
    );
  }

  const consumerOptions = parseConsumerOptions(
    environment,
    DEFAULT_CONSUMER_GUILD_ID,
  );
  return {
    kind: "options",
    options: {
      backendPort,
      webPort,
      temporalPort: resolvedTemporalPort,
      temporalUiPort: resolvedTemporalUiPort,
      databaseUrl:
        cli.databaseUrl ?? defaultDatabaseUrl(backendPort, environment),
      discordGatewayEnabled:
        cli.discordGatewayEnabled ??
        environment["SCOUT_DEV_NO_GATEWAY"] !== "true",
      backendWatchEnabled:
        cli.backendWatchEnabled ??
        environment["SCOUT_DEV_NO_BACKEND_WATCH"] !== "true",
      marketingOrigin:
        cli.marketingOrigin ??
        parseDevOrigin(
          environment["SCOUT_DEV_MARKETING_ORIGIN"] ?? "http://localhost:4321",
          "SCOUT_DEV_MARKETING_ORIGIN",
        ),
      docsOrigin:
        cli.docsOrigin ??
        parseDevOrigin(
          environment["SCOUT_DEV_DOCS_ORIGIN"] ?? "http://localhost:4322",
          "SCOUT_DEV_DOCS_ORIGIN",
        ),
      ...consumerOptions,
    },
  };
}
