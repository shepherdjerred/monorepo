import configuration from "#src/configuration.ts";
import { z } from "zod";
import { prisma } from "#src/db/index.ts";
import { REQUIRED_MIGRATIONS } from "#src/db/migrate.ts";
import client from "#src/discord/client.ts";
import {
  gatewayDownForMs,
  isGatewayConnected,
  isLive,
} from "#src/discord/gateway-state.ts";

const MigrationRowsSchema = z.array(z.object({ migration_name: z.string() }));

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
  } catch (error) {
    // Readiness is a status report, not a control path: a database that is
    // down must render as `ready: false`, not throw out of the handler and
    // return a 500 the kubelet reads as an unknown failure.
    console.error("[Health] Database check failed:", error);
    return { database: false, migrations: false };
  }
}

export async function readiness(): Promise<{
  ready: boolean;
  checks: Record<string, boolean>;
}> {
  const checks = {
    ...(await databaseChecks()),
    discord: client.isReady(),
    gateway: isGatewayConnected(),
  };
  return { ready: Object.values(checks).every(Boolean), checks };
}

console.warn(
  `[Server] Starting health server on port ${configuration.port.toString()}...`,
);

Bun.serve({
  port: configuration.port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/live") {
      const downFor = gatewayDownForMs();
      const live = isLive(downFor);
      if (!live) {
        console.error(
          `[Health] Reporting NOT live: gateway down for ${Math.round(downFor / 1000).toString()}s`,
        );
      }
      return Response.json(
        { live, gatewayDownForMs: downFor },
        { status: live ? 200 : 503 },
      );
    }

    if (url.pathname === "/ready") {
      const result = await readiness();
      return Response.json(result, { status: result.ready ? 200 : 503 });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.warn(
  `[Server] Health server listening on http://localhost:${configuration.port.toString()}`,
);
