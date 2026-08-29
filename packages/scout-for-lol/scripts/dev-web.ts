import path from "node:path";
import { adoptSeedIfUnseeded, resolveBackendLakeDir } from "./dev-lake-seed.ts";
import { buildDevEnvironment, devWebOrigins } from "./dev-web-environment.ts";
import {
  parseDevWebArgs as parseDevWebArgsFromOptions,
  sharedServerDatabaseName as sharedServerDatabaseNameFromOptions,
} from "./dev-web-options.ts";
import { unresolvedSecrets } from "./migration-core.ts";
import { startTemporalDevServer } from "./dev-web-temporal.ts";

export function parseDevWebArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
) {
  return parseDevWebArgsFromOptions(args, environment);
}

export function sharedServerDatabaseName(
  databaseUrl: string,
  environment: Readonly<Record<string, string | undefined>>,
) {
  return sharedServerDatabaseNameFromOptions(databaseUrl, environment);
}

const DEFAULT_DESIGN_AUDIT_LAKE_DIR = "./.design-audit-report-lake";
const BACKEND_START_TIMEOUT_MS = 300_000;
const DEFAULT_CONSUMER_GUILD_ID = "1337623164146155593";

function printHelp(): void {
  console.log(`Usage: bun run dev:web -- [options]

Options:
  --backend-port <port>  Backend port (default: 3000)
  --web-port <port>      Vite SPA port (default: 5180)
  --database-url <url>   Postgres URL (default: scout_dev_<backend-port> on
                         the shared local dev server, port 5471 / SCOUT_PG_PORT)
  --temporal-port <port> Temporal gRPC port (default: backend port + 4233)
  --temporal-ui-port <port> Temporal UI port (default: backend port + 5233)
  --no-discord-gateway   Run as a secondary UI/API copy without BETA gateway
  --no-background-jobs   Skip scheduled workers and report-lake preparation
  --no-web               Skip the Vite SPA
  --no-backend-watch     Keep the backend stable until this command is restarted
  --marketing-origin <url>  Marketing site origin for cross-surface links
  --docs-origin <url>       Docs site origin for cross-surface links
  SCOUT_DEV_AUTH_MODE=oauth  Opt into real Discord OAuth locally
  SCOUT_DEV_CONSUMER_PREVIEW=false  Disable local Explore/Players preview
  --help                 Show this help

For a second copy, choose different ports. Its database defaults to
scout_dev_<backend-port> on the shared local Postgres. The BETA Discord gateway still has one
owner: run one gateway owner and pass --no-discord-gateway to secondary copies.
Secondary copies do not have the live bot guild/channel cache, so guild-picker
and channel-picker flows require the gateway owner.`);
}

async function waitForBackend(
  backendOrigin: string,
  backend: Bun.Subprocess,
): Promise<void> {
  const startedAt = Date.now();
  let lastFailure: unknown;
  while (Date.now() - startedAt < BACKEND_START_TIMEOUT_MS) {
    if (backend.exitCode !== null) {
      throw new Error(
        `Scout backend exited with code ${backend.exitCode.toString()} before becoming ready`,
      );
    }
    try {
      const response = await fetch(`${backendOrigin}/api/version`);
      if (response.ok) return;
      lastFailure = new Error(
        `Scout backend readiness returned HTTP ${response.status.toString()}`,
      );
    } catch (error) {
      lastFailure = error;
    }
    await Bun.sleep(250);
  }
  throw new Error(
    `Scout backend did not become ready within ${BACKEND_START_TIMEOUT_MS.toString()}ms`,
    { cause: lastFailure },
  );
}

export function shouldPrepareReportLake(
  options: { readonly backgroundJobsEnabled: boolean },
  isDesignAuditBoot: boolean,
): boolean {
  return isDesignAuditBoot || options.backgroundJobsEnabled;
}

export function resolveBackendEntrypoint(
  environment: Readonly<Record<string, string | undefined>>,
): "src/index.ts" | "src/dev-discord.ts" {
  const configured = environment["SCOUT_DEV_BACKEND_ENTRYPOINT"];
  if (configured === undefined || configured === "src/index.ts") {
    return "src/index.ts";
  }
  if (configured === "src/dev-discord.ts") {
    return configured;
  }
  throw new Error(
    "SCOUT_DEV_BACKEND_ENTRYPOINT must be src/index.ts or src/dev-discord.ts",
  );
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
    const { backendOrigin, webOrigin } = devWebOrigins(options);
    const backendCwd = path.join(root, "packages", "backend");
    const lakeDir = resolveBackendLakeDir(
      backendCwd,
      isDesignAuditBoot
        ? DEFAULT_DESIGN_AUDIT_LAKE_DIR
        : Bun.env["REPORT_LAKE_DIR"],
    );
    if (shouldPrepareReportLake(options, isDesignAuditBoot)) {
      console.log(await adoptSeedIfUnseeded(lakeDir));
    } else {
      console.log(
        "Report lake: skipped (background jobs are disabled for this runtime)",
      );
    }

    const environment = buildDevEnvironment(
      Bun.env,
      options,
      lakeDir,
      isDesignAuditBoot,
    );
    if (isDesignAuditBoot) {
      environment["JWT_SIGNING_SECRET"] ??=
        "design-audit-local-jwt-signing-secret-32-bytes";
      environment["DEV_USER_GUILDS"] ??=
        Bun.env["SCOUT_DESIGN_AUDIT_GUILD_ID"] ?? DEFAULT_CONSUMER_GUILD_ID;
      environment["EXPLORE_GUILD_ALLOWLIST"] ??=
        Bun.env["SCOUT_DESIGN_AUDIT_GUILD_ID"] ?? DEFAULT_CONSUMER_GUILD_ID;
    }
    environment["TEMPORAL_ADDRESS"] =
      `127.0.0.1:${options.temporalPort.toString()}`;
    environment["TEMPORAL_NAMESPACE"] = "dev";
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

    console.log(`Applying Prisma migrations against ${options.databaseUrl}`);
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
      const generate = Bun.spawn(["bun", "run", "db:generate"], {
        cwd: backendCwd,
        env: environment,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const generateExitCode = await generate.exited;
      if (generateExitCode !== 0) {
        throw new Error(
          `Prisma client generation failed with exit code ${generateExitCode.toString()}`,
        );
      }
    }

    const temporal = await startTemporalDevServer({
      root,
      backendPort: options.backendPort,
      temporalPort: options.temporalPort,
      temporalUiPort: options.temporalUiPort,
      environment,
    });
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

    const backendEntrypoint = resolveBackendEntrypoint(Bun.env);
    const backendCommand =
      !isDesignAuditBoot && options.backendWatchEnabled
        ? ["bun", "--watch", backendEntrypoint]
        : ["bun", backendEntrypoint];
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
    const app = options.webEnabled
      ? Bun.spawn(
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
        )
      : null;
    const devLoginUrl = `${webOrigin}/api/dev/login?returnTo=${encodeURIComponent("/app/")}`;
    console.log(
      [
        "Scout local dev is starting",
        `SPA: ${webOrigin}/app/`,
        `Backend: ${backendOrigin}/trpc/`,
        `Backend entrypoint: ${backendEntrypoint}`,
        `Temporal UI: http://127.0.0.1:${options.temporalUiPort.toString()}/`,
        `Database: ${options.databaseUrl}`,
        `Discord gateway: ${options.discordGatewayEnabled ? "enabled" : "disabled"}`,
        `Background jobs: ${options.backgroundJobsEnabled ? "enabled" : "disabled"}`,
        `Report lake preparation: ${shouldPrepareReportLake(options, isDesignAuditBoot) ? "enabled" : "skipped"}`,
        `Vite: ${options.webEnabled ? webOrigin : "disabled"}`,
        `Backend watch: ${options.backendWatchEnabled ? "enabled" : "disabled"}`,
        `Auth: ${options.authMode}`,
        `Consumer preview: ${options.consumerPreview ? (options.consumerGuildId ?? "unset") : "disabled"}`,
        `Local login: ${devLoginUrl}`,
        `OAuth callback: ${webOrigin}/api/auth/discord/callback`,
        options.authMode === "oauth"
          ? "Real Discord OAuth: active (callback must be registered on the BETA Discord app)"
          : `Real Discord OAuth: SCOUT_DEV_AUTH_MODE=oauth bun run --filter='./packages/scout-for-lol' dev:web -- --backend-port ${options.backendPort.toString()} --web-port ${options.webPort.toString()}`,
      ].join("\n"),
    );
    const stop = (): void => {
      backend.kill();
      app?.kill();
      temporal.kill();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    const exitCode = await Promise.race([
      backend.exited,
      ...(app === null ? [] : [app.exited]),
      temporal.exited,
    ]);
    stop();
    await Promise.all([
      backend.exited,
      ...(app === null ? [] : [app.exited]),
      temporal.exited,
    ]);
    process.exitCode = exitCode;
  }
}
