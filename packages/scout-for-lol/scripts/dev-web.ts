import path from "node:path";
import { adoptSeedIfUnseeded, resolveBackendLakeDir } from "./dev-lake-seed.ts";
import { requireCliValue, unresolvedSecrets } from "./migration-core.ts";
import {
  DEFAULT_DESIGN_AUDIT_LAKE_DIR,
  origins,
  pinnedTemporalExecutable,
  printHelp,
  sharedServerDatabaseName,
  waitForBackend,
  waitForTemporal,
} from "./dev-web-runtime-helpers.ts";

const DEFAULT_BACKEND_PORT = 3000;
const DEFAULT_WEB_PORT = 5180;
const TEMPORAL_PORT_OFFSET = 4233;
const TEMPORAL_UI_PORT_OFFSET = 5233;
const DEFAULT_PG_PORT = "5471";
const DEFAULT_DESIGN_AUDIT_LAKE_DIR = "./.design-audit-report-lake";
const DEFAULT_DESIGN_AUDIT_DATABASE_NAME = "scout_design_audit";

export type DevWebOptions = {
  readonly backendPort: number;
  readonly webPort: number;
  readonly temporalPort: number;
  readonly temporalUiPort: number;
  readonly databaseUrl: string;
  readonly discordGatewayEnabled: boolean;
  readonly backendWatchEnabled: boolean;
  readonly marketingOrigin: string;
  readonly docsOrigin: string;
};

type ParseResult =
  | { readonly kind: "help" }
  | { readonly kind: "options"; readonly options: DevWebOptions };

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

function parseOrigin(value: string, flag: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error(`${flag} must be an absolute http:// or https:// origin`);
  }
  if (
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.pathname !== "/" ||
    origin.search.length > 0 ||
    origin.hash.length > 0
  ) {
    throw new Error(`${flag} must be an absolute http:// or https:// origin`);
  }
  return origin.origin;
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

export function parseDevWebArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): ParseResult {
  const state = initialOptions(environment);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const consumed = applyArgument(state, args, index, argument);
    if (consumed === "help") return { kind: "help" };
    index += consumed;
  }

  const ports = resolvePorts(state);

  return {
    kind: "options",
    options: {
      backendPort: state.backendPort,
      webPort: state.webPort,
      temporalPort: ports.temporalPort,
      temporalUiPort: ports.temporalUiPort,
      databaseUrl:
        state.databaseUrl ?? defaultDatabaseUrl(state.backendPort, environment),
      discordGatewayEnabled: state.discordGatewayEnabled,
      backendWatchEnabled: state.backendWatchEnabled,
      marketingOrigin: state.marketingOrigin,
      docsOrigin: state.docsOrigin,
    },
  };
}

type ParseState = {
  backendPort: number;
  webPort: number;
  databaseUrl?: string;
  temporalPort?: number;
  temporalUiPort?: number;
  discordGatewayEnabled: boolean;
  backendWatchEnabled: boolean;
  marketingOrigin: string;
  docsOrigin: string;
};

function initialOptions(
  environment: Readonly<Record<string, string | undefined>>,
): ParseState {
  return {
    backendPort: parsePort(
      environment["SCOUT_DEV_BACKEND_PORT"] ?? DEFAULT_BACKEND_PORT.toString(),
      "SCOUT_DEV_BACKEND_PORT",
    ),
    webPort: parsePort(
      environment["SCOUT_DEV_WEB_PORT"] ?? DEFAULT_WEB_PORT.toString(),
      "SCOUT_DEV_WEB_PORT",
    ),
    temporalPort: optionalPort(environment, "SCOUT_DEV_TEMPORAL_PORT"),
    temporalUiPort: optionalPort(environment, "SCOUT_DEV_TEMPORAL_UI_PORT"),
    discordGatewayEnabled: environment["SCOUT_DEV_NO_GATEWAY"] !== "true",
    backendWatchEnabled: environment["SCOUT_DEV_NO_BACKEND_WATCH"] !== "true",
    marketingOrigin: parseOrigin(
      environment["SCOUT_DEV_MARKETING_ORIGIN"] ?? "http://localhost:4321",
      "SCOUT_DEV_MARKETING_ORIGIN",
    ),
    docsOrigin: parseOrigin(
      environment["SCOUT_DEV_DOCS_ORIGIN"] ?? "http://localhost:4322",
      "SCOUT_DEV_DOCS_ORIGIN",
    ),
  };
}

function optionalPort(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): number | undefined {
  const value = environment[name];
  return value === undefined ? undefined : parsePort(value, name);
}

function applyArgument(
  state: ParseState,
  args: readonly string[],
  index: number,
  argument: string | undefined,
): number | "help" {
  if (argument === "--help" || argument === "-h") return "help";
  const valueOptions: Readonly<Record<string, (value: string) => void>> = {
    "--backend-port": (value) => {
      state.backendPort = parsePort(value, "--backend-port");
    },
    "--web-port": (value) => {
      state.webPort = parsePort(value, "--web-port");
    },
    "--database-url": (value) => {
      state.databaseUrl = parseDatabaseUrl(value);
    },
    "--temporal-port": (value) => {
      state.temporalPort = parsePort(value, "--temporal-port");
    },
    "--temporal-ui-port": (value) => {
      state.temporalUiPort = parsePort(value, "--temporal-ui-port");
    },
    "--marketing-origin": (value) => {
      state.marketingOrigin = parseOrigin(value, "--marketing-origin");
    },
    "--docs-origin": (value) => {
      state.docsOrigin = parseOrigin(value, "--docs-origin");
    },
  };
  const valueHandler =
    argument === undefined ? undefined : valueOptions[argument];
  if (valueHandler !== undefined) {
    valueHandler(requireCliValue(args, index, argument));
    return 1;
  }
  if (argument === "--no-discord-gateway") {
    state.discordGatewayEnabled = false;
    return 0;
  }
  if (argument === "--no-backend-watch") {
    state.backendWatchEnabled = false;
    return 0;
  }
  throw new Error(`Unknown argument: ${argument ?? "<missing>"}`);
}

function resolvePorts(state: ParseState): {
  readonly temporalPort: number;
  readonly temporalUiPort: number;
} {
  const temporalPort =
    state.temporalPort ??
    parsePort(
      (state.backendPort + TEMPORAL_PORT_OFFSET).toString(),
      "derived Temporal port",
    );
  const temporalUiPort =
    state.temporalUiPort ??
    parsePort(
      (state.backendPort + TEMPORAL_UI_PORT_OFFSET).toString(),
      "derived Temporal UI port",
    );
  if (
    new Set([state.backendPort, state.webPort, temporalPort, temporalUiPort])
      .size !== 4
  ) {
    throw new Error(
      "--backend-port, --web-port, --temporal-port, and --temporal-ui-port must be different",
    );
  }
  return { temporalPort, temporalUiPort };
}

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const isDesignAuditBoot = Bun.env["SCOUT_DESIGN_AUDIT_LOCAL_BOOT"] === "true";
  const parsed = parseDevWebArgs(Bun.argv.slice(2));
  if (parsed.kind === "help") {
    printHelp();
  } else {
    if (!isDesignAuditBoot) {
      const missing = unresolvedSecrets(Bun.env);
      if (missing.length > 0) {
        throw new Error(
          `${missing.join(", ")} not resolved. Run with op run --env-file=${root}/dev-web.env.tpl -- bun ${import.meta.path}`,
        );
      }
    }
    const { options } = parsed;
    const { backendOrigin, webOrigin } = origins(options);
    const backendCwd = path.join(root, "packages", "backend");
    const lakeDir = resolveBackendLakeDir(
      backendCwd,
      isDesignAuditBoot
        ? DEFAULT_DESIGN_AUDIT_LAKE_DIR
        : Bun.env["REPORT_LAKE_DIR"],
    );
    console.log(await adoptSeedIfUnseeded(lakeDir));

    const environment = {
      ...Bun.env,
      DATABASE_URL: options.databaseUrl,
      ENABLE_DEV_LOGIN: "true",
      // #2314 made this mandatory with no default, on purpose, and updated the
      // cdk8s charts but not this script — so every local boot crashed at
      // startup with "FEATURE_FLAGS_MODE is required" before the backend ever
      // listened. Local dev has no Flipt to reach, so `disabled` is the honest
      // answer; an explicit ambient value still wins for anyone pointing at a
      // real flag backend.
      FEATURE_FLAGS_MODE: Bun.env["FEATURE_FLAGS_MODE"] ?? "disabled",
      PORT: options.backendPort.toString(),
      SCOUT_DEV_BACKEND_URL: backendOrigin,
      SCOUT_DEV_WEB_ORIGIN: webOrigin,
      VITE_MARKETING_ORIGIN: options.marketingOrigin,
      VITE_DOCS_ORIGIN: options.docsOrigin,
      ENABLE_BACKGROUND_JOBS:
        isDesignAuditBoot || !options.discordGatewayEnabled ? "false" : "true",
      ENABLE_DISCORD_GATEWAY:
        isDesignAuditBoot || !options.discordGatewayEnabled ? "false" : "true",
      WEB_APP_ORIGIN: webOrigin,
      REPORT_LAKE_DIR: lakeDir,
      TEMPORAL_ADDRESS: `127.0.0.1:${options.temporalPort.toString()}`,
      TEMPORAL_NAMESPACE: "default",
      ...(isDesignAuditBoot
        ? {
            NODE_ENV: "test",
            // Flipt is unreachable from a local/CI design-audit boot, and
            // loadFeatureFlagConfiguration refuses to default this on
            // purpose (see @shepherdjerred/feature-flags). Without it the
            // backend throws during startup, every design-audit route loads
            // against a dead API, and any backend-dependent UI renders its
            // error/fallback state instead of the real page.
            FEATURE_FLAGS_MODE: Bun.env["FEATURE_FLAGS_MODE"] ?? "disabled",
            JWT_SIGNING_SECRET:
              Bun.env["JWT_SIGNING_SECRET"] ??
              "design-audit-local-jwt-signing-secret-32-bytes",
            DEV_USER_GUILDS:
              Bun.env["DEV_USER_GUILDS"] ??
              Bun.env["SCOUT_DESIGN_AUDIT_GUILD_ID"] ??
              "1337623164146155593",
            EXPLORE_GUILD_ALLOWLIST:
              Bun.env["EXPLORE_GUILD_ALLOWLIST"] ??
              Bun.env["SCOUT_DESIGN_AUDIT_GUILD_ID"] ??
              "1337623164146155593",
          }
        : {}),
    };

    const sharedDbName = sharedServerDatabaseName(options.databaseUrl, Bun.env);
    if (sharedDbName !== undefined) {
      const ensure = Bun.spawn(
        ["bun", "run", "scripts/ensure-dev-postgres.ts", sharedDbName],
        {
          cwd: backendCwd,
          env: environment,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      if ((await ensure.exited) !== 0) {
        throw new Error("Failed to start the shared local dev Postgres");
      }
    }

    console.log(
      `Applying Prisma migrations against ${environment.DATABASE_URL}`,
    );
    const migration = Bun.spawn(
      ["bun", "x", "--no-install", "prisma", "migrate", "deploy"],
      {
        cwd: backendCwd,
        env: environment,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const migrationExitCode = await migration.exited;
    if (migrationExitCode !== 0) {
      throw new Error(
        `Prisma migrations failed with exit code ${migrationExitCode.toString()}`,
      );
    }
    if (isDesignAuditBoot) {
      const generate = Bun.spawn(
        ["bun", "x", "--no-install", "prisma", "generate"],
        {
          cwd: backendCwd,
          env: environment,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      const generateExitCode = await generate.exited;
      if (generateExitCode !== 0) {
        throw new Error(
          `Prisma client generation failed with exit code ${generateExitCode.toString()}`,
        );
      }
    }

    const temporalDatabase = path.join(
      root,
      `.temporal-dev-${options.backendPort.toString()}.db`,
    );
    const temporal = Bun.spawn(
      [
        pinnedTemporalExecutable(root),
        "--disable-config-file",
        "server",
        "start-dev",
        "--ip",
        "127.0.0.1",
        "--port",
        options.temporalPort.toString(),
        "--ui-port",
        options.temporalUiPort.toString(),
        "--db-filename",
        temporalDatabase,
      ],
      {
        cwd: root,
        env: environment,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    try {
      await waitForTemporal(options.temporalUiPort, temporal);
    } catch (error: unknown) {
      temporal.kill();
      await temporal.exited;
      throw error;
    }
    if (isDesignAuditBoot) {
      const seed = Bun.spawn(["bun", "scripts/seed-design-audit.ts"], {
        cwd: backendCwd,
        env: environment,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const seedExitCode = await seed.exited;
      if (seedExitCode !== 0) {
        temporal.kill();
        await temporal.exited;
        throw new Error(
          `Design-audit database seeding failed with exit code ${seedExitCode.toString()}`,
        );
      }
    }

    const backendCommand =
      !isDesignAuditBoot && options.backendWatchEnabled
        ? ["bun", "--watch", "src/index.ts"]
        : ["bun", "src/index.ts"];
    const backend = Bun.spawn(backendCommand, {
      cwd: backendCwd,
      env: {
        ...environment,
        ...(isDesignAuditBoot ? { NODE_ENV: "test" } : {}),
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (isDesignAuditBoot) {
      try {
        await waitForBackend(backendOrigin, backend);
      } catch (error) {
        backend.kill();
        temporal.kill();
        await Promise.all([backend.exited, temporal.exited]);
        throw error;
      }
    }
    const app = Bun.spawn(
      [
        "bun",
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        options.webPort.toString(),
        "--strictPort",
        ...(isDesignAuditBoot ? ["--force"] : []),
      ],
      {
        cwd: path.join(root, "packages", "app"),
        env: environment,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    console.log(
      `Scout local dev is starting\nSPA: ${webOrigin}/app/\nBackend: ${backendOrigin}/trpc/\nTemporal UI: http://127.0.0.1:${options.temporalUiPort.toString()}/\nDatabase: ${options.databaseUrl}\nBackend watch: ${options.backendWatchEnabled ? "enabled" : "disabled"}`,
    );
    const stop = (): void => {
      backend.kill();
      app.kill();
      temporal.kill();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    const exitCode = await Promise.race([
      backend.exited,
      app.exited,
      temporal.exited,
    ]);
    stop();
    await Promise.all([backend.exited, app.exited, temporal.exited]);
    process.exitCode = exitCode;
  }
}
