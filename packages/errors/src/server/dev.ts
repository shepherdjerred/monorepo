import path from "node:path";
import {
  createDatabase,
  createPrismaErrorsRepository,
} from "#infrastructure/db.ts";
import { createInMemoryErrorsRepository } from "#infrastructure/in-memory-db.ts";
import { createErrorsMetrics } from "#infrastructure/telemetry.ts";
import { createTrackerIssueClient } from "#infrastructure/tracker-client.ts";
import { createAdminApp } from "#server/admin-app.ts";
import { seedRichDemoFixture } from "#server/fixture-seed.ts";
import { createIngestApp } from "#server/ingest-app.ts";
import {
  DEFAULT_PUBLIC_INGEST_HOST,
  DEFAULT_TAILNET_CONSOLE_URL,
  DEFAULT_TRACKER_BASE_URL,
} from "#shared/contract.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");
const args = new Set(Bun.argv.slice(2));
const databaseUrl = Bun.env["DATABASE_URL"]?.trim();
const useFixture =
  args.has("--fixture") ||
  Bun.env["ERRORS_FIXTURE"] === "1" ||
  databaseUrl === undefined ||
  databaseUrl === "";

const host = Bun.env["HOST"]?.trim() ?? "127.0.0.1";
const portRaw = Bun.env["PORT"]?.trim();
const port =
  portRaw === undefined || portRaw === "" ? 7370 : Number.parseInt(portRaw, 10);
const ingestPortRaw = Bun.env["ERRORS_INGEST_PORT"]?.trim();
const ingestPort =
  ingestPortRaw === undefined || ingestPortRaw === ""
    ? undefined
    : Number.parseInt(ingestPortRaw, 10);

const publicIngestOrigin =
  Bun.env["PUBLIC_INGEST_ORIGIN"]?.trim() ?? DEFAULT_PUBLIC_INGEST_HOST;
const consolePublicOrigin =
  Bun.env["CONSOLE_PUBLIC_ORIGIN"]?.trim() ?? DEFAULT_TAILNET_CONSOLE_URL;

const repo = useFixture
  ? createInMemoryErrorsRepository({ publicIngestOrigin, consolePublicOrigin })
  : createPrismaErrorsRepository(createDatabase(databaseUrl), {
      publicIngestOrigin,
      consolePublicOrigin,
    });

if (useFixture) {
  await seedRichDemoFixture(repo);
} else {
  await repo.seedCanonicalProjects();
}

let fixtureTicketCounter = 600;
const trackerClient = useFixture
  ? {
      issueUrlForIdentifier: (identifier: string) =>
        `${DEFAULT_TRACKER_BASE_URL}/AI/issues/${identifier}`,
      createIssue: () => {
        fixtureTicketCounter += 1;
        const identifier = `AI-${String(fixtureTicketCounter)}`;
        return Promise.resolve({
          identifier,
          url: `${DEFAULT_TRACKER_BASE_URL}/AI/issues/${identifier}`,
        });
      },
    }
  : createTrackerIssueClient({
      apiUrl:
        Bun.env["TRACKER_API_URL"]?.trim() ??
        "http://tracker.tracker.svc.cluster.local:7351",
      publicUrl:
        Bun.env["TRACKER_PUBLIC_URL"]?.trim() ?? DEFAULT_TRACKER_BASE_URL,
    });

const metrics = createErrorsMetrics();
const adminApp = createAdminApp({
  repo,
  trackerClient,
  trackerCreationEnabled: () => Promise.resolve(true),
  ingestEnabled: () => Promise.resolve(true),
  consolePublicOrigin,
  metrics,
});

const adminServer = Bun.serve({
  hostname: host,
  port,
  fetch: adminApp.fetch,
});

const ingestServer =
  ingestPort === undefined
    ? undefined
    : Bun.serve({
        hostname: host,
        port: ingestPort,
        fetch: createIngestApp({
          repo,
          ingestEnabled: () => Promise.resolve(true),
          metrics,
        }).fetch,
      });

console.warn(
  JSON.stringify({
    message: "errors_dev_started",
    adminUrl: `http://${host}:${String(adminServer.port)}`,
    ingestPort: ingestServer?.port ?? null,
    storage: useFixture ? "fixture-memory" : "postgres",
  }),
);

function launchOptionalViteDev(
  cwd: string,
  cliFlags: ReadonlySet<string>,
): ReturnType<typeof Bun.spawn> | undefined {
  if (Bun.env["ERRORS_NO_VITE"] === "1" || cliFlags.has("--no-vite")) {
    return undefined;
  }
  return Bun.spawn(["bunx", "--no-install", "vite"], {
    cwd,
    env: Bun.env,
    stdout: "inherit",
    stderr: "inherit",
  });
}

const viteProcess = launchOptionalViteDev(packageRoot, args);

async function closeDevServers(): Promise<void> {
  if (viteProcess !== undefined) {
    viteProcess.kill();
    await viteProcess.exited;
  }
  await Promise.all([ingestServer?.stop(), adminServer.stop()]);
  await repo.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void closeDevServers();
  });
}
