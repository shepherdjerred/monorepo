import { z } from "zod";
import { REQUIRED_MIGRATIONS } from "@shepherdjerred/birmel/database/migration-bootstrap.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

const MigrationRowsSchema = z.array(z.object({ migration_name: z.string() }));

let healthServer: ReturnType<typeof Bun.serve> | null = null;

async function databaseChecks(): Promise<{
  database: boolean;
  migrations: boolean;
}> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const rows = MigrationRowsSchema.parse(
      await prisma.$queryRaw`
        SELECT migration_name
        FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `,
    );
    const applied = new Set(rows.map((row) => row.migration_name));
    return {
      database: true,
      migrations: REQUIRED_MIGRATIONS.every((migration) =>
        applied.has(migration),
      ),
    };
  } catch {
    return { database: false, migrations: false };
  }
}

async function readiness(isSchedulerStarted: () => boolean): Promise<{
  ready: boolean;
  checks: Record<string, boolean>;
}> {
  const databaseState = await databaseChecks();
  const checks = {
    ...databaseState,
    discord: getDiscordClient().isReady(),
    scheduler: isSchedulerStarted(),
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
  };
}

export function startHealthServer(options: {
  port: number;
  isSchedulerStarted: () => boolean;
}): void {
  if (healthServer != null) {
    throw new Error("Birmel health server is already running");
  }
  healthServer = Bun.serve({
    port: options.port,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/live") {
        return Response.json({ live: true });
      }
      if (path === "/ready") {
        const result = await readiness(options.isSchedulerStarted);
        return Response.json(result, { status: result.ready ? 200 : 503 });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  logger.info("Health server started", { port: options.port });
}

export async function stopHealthServer(): Promise<void> {
  if (healthServer == null) {
    return;
  }
  await healthServer.stop(true);
  healthServer = null;
}
