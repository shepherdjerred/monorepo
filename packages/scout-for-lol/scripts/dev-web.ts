import path from "node:path";
import { adoptSeedIfUnseeded, resolveBackendLakeDir } from "./dev-lake-seed.ts";
import { requireCliValue, unresolvedSecrets } from "./migration-core.ts";

const DEFAULT_BACKEND_PORT = 3000;
const DEFAULT_WEB_PORT = 5180;
const DEFAULT_DATABASE_URL = "file:./local-web-dev.db";

type DevWebOptions = {
  readonly backendPort: number;
  readonly webPort: number;
  readonly databaseUrl: string;
  readonly discordGatewayEnabled: boolean;
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
  if (!value.startsWith("file:")) {
    throw new Error("--database-url must use a local file: SQLite URL");
  }
  return value;
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
  if (backendPort === DEFAULT_BACKEND_PORT) return DEFAULT_DATABASE_URL;
  return `file:./local-web-dev-${backendPort.toString()}.db`;
}

export function parseDevWebArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): ParseResult {
  let backendPort = parsePort(
    environment["SCOUT_DEV_BACKEND_PORT"] ?? DEFAULT_BACKEND_PORT.toString(),
    "SCOUT_DEV_BACKEND_PORT",
  );
  let webPort = parsePort(
    environment["SCOUT_DEV_WEB_PORT"] ?? DEFAULT_WEB_PORT.toString(),
    "SCOUT_DEV_WEB_PORT",
  );
  let databaseUrl: string | undefined;
  let discordGatewayEnabled = environment["SCOUT_DEV_NO_GATEWAY"] !== "true";
  let marketingOrigin = parseOrigin(
    environment["SCOUT_DEV_MARKETING_ORIGIN"] ?? "http://localhost:4321",
    "SCOUT_DEV_MARKETING_ORIGIN",
  );
  let docsOrigin = parseOrigin(
    environment["SCOUT_DEV_DOCS_ORIGIN"] ?? "http://localhost:4322",
    "SCOUT_DEV_DOCS_ORIGIN",
  );

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      return { kind: "help" };
    }
    if (argument === "--backend-port") {
      backendPort = parsePort(
        requireCliValue(args, index, argument),
        "--backend-port",
      );
      index += 1;
      continue;
    }
    if (argument === "--web-port") {
      webPort = parsePort(requireCliValue(args, index, argument), "--web-port");
      index += 1;
      continue;
    }
    if (argument === "--database-url") {
      databaseUrl = parseDatabaseUrl(requireCliValue(args, index, argument));
      index += 1;
      continue;
    }
    if (argument === "--no-discord-gateway") {
      discordGatewayEnabled = false;
      continue;
    }
    if (argument === "--marketing-origin") {
      marketingOrigin = parseOrigin(
        requireCliValue(args, index, argument),
        "--marketing-origin",
      );
      index += 1;
      continue;
    }
    if (argument === "--docs-origin") {
      docsOrigin = parseOrigin(
        requireCliValue(args, index, argument),
        "--docs-origin",
      );
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? "<missing>"}`);
  }

  if (backendPort === webPort) {
    throw new Error("--backend-port and --web-port must be different");
  }

  return {
    kind: "options",
    options: {
      backendPort,
      webPort,
      databaseUrl: databaseUrl ?? defaultDatabaseUrl(backendPort, environment),
      discordGatewayEnabled,
      marketingOrigin,
      docsOrigin,
    },
  };
}

function printHelp(): void {
  console.log(`Usage: bun run dev:web -- [options]

Options:
  --backend-port <port>  Backend port (default: 3000)
  --web-port <port>      Vite SPA port (default: 5180)
  --database-url <url>   Local file: SQLite URL
  --no-discord-gateway   Run as a secondary UI/API copy without BETA gateway
  --marketing-origin <url>  Marketing site origin for cross-surface links
  --docs-origin <url>       Docs site origin for cross-surface links
  --help                 Show this help

For a second copy, choose different ports. Its database defaults to
file:./local-web-dev-<backend-port>.db. The BETA Discord gateway still has one
owner: run one gateway owner and pass --no-discord-gateway to secondary copies.
Secondary copies do not have the live bot guild/channel cache, so guild-picker
and channel-picker flows require the gateway owner.`);
}

function origins(options: DevWebOptions): {
  readonly backendOrigin: string;
  readonly webOrigin: string;
} {
  return {
    backendOrigin: `http://127.0.0.1:${options.backendPort.toString()}`,
    webOrigin: `http://localhost:${options.webPort.toString()}`,
  };
}

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const parsed = parseDevWebArgs(Bun.argv.slice(2));
  if (parsed.kind === "help") {
    printHelp();
  } else {
    const missing = unresolvedSecrets(Bun.env);
    if (missing.length > 0) {
      throw new Error(
        `${missing.join(", ")} not resolved. Run with op run --env-file=${root}/dev-web.env.tpl -- bun ${import.meta.path}`,
      );
    }
    const { options } = parsed;
    const { backendOrigin, webOrigin } = origins(options);
    const backendCwd = path.join(root, "packages", "backend");
    const lakeDir = resolveBackendLakeDir(
      backendCwd,
      Bun.env["REPORT_LAKE_DIR"],
    );
    console.log(await adoptSeedIfUnseeded(lakeDir));

    const environment = {
      ...Bun.env,
      DATABASE_URL: options.databaseUrl,
      ENABLE_DEV_LOGIN: "true",
      PORT: options.backendPort.toString(),
      SCOUT_DEV_BACKEND_URL: backendOrigin,
      SCOUT_DEV_WEB_ORIGIN: webOrigin,
      VITE_MARKETING_ORIGIN: options.marketingOrigin,
      VITE_DOCS_ORIGIN: options.docsOrigin,
      ENABLE_BACKGROUND_JOBS: options.discordGatewayEnabled ? "true" : "false",
      ENABLE_DISCORD_GATEWAY: options.discordGatewayEnabled ? "true" : "false",
      WEB_APP_ORIGIN: webOrigin,
      REPORT_LAKE_DIR: lakeDir,
    };

    console.log(
      `Applying Prisma migrations against ${environment.DATABASE_URL}`,
    );
    const migration = Bun.spawn(["bunx", "prisma", "migrate", "deploy"], {
      cwd: backendCwd,
      env: environment,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const migrationExitCode = await migration.exited;
    if (migrationExitCode !== 0) {
      throw new Error(
        `Prisma migrations failed with exit code ${migrationExitCode.toString()}`,
      );
    }

    const backend = Bun.spawn(["bun", "--watch", "src/index.ts"], {
      cwd: backendCwd,
      env: environment,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
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
      `Scout local dev is starting\nSPA: ${webOrigin}/app/\nBackend: ${backendOrigin}/trpc/\nDatabase: ${options.databaseUrl}`,
    );
    const stop = (): void => {
      backend.kill();
      app.kill();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    const exitCode = await Promise.race([backend.exited, app.exited]);
    stop();
    await Promise.all([backend.exited, app.exited]);
    process.exitCode = exitCode;
  }
}
