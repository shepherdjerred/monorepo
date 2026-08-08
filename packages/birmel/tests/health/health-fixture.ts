import { Database } from "bun:sqlite";
import { z } from "zod";

const InputSchema = z.object({
  scenario: z.enum([
    "database-down",
    "migrations-missing",
    "discord-down",
    "scheduler-down",
    "ready",
  ]),
  databasePath: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65_535),
});

const input = InputSchema.parse({
  scenario: Bun.argv[2],
  databasePath: Bun.argv[3],
  port: Bun.argv[4],
});

const databaseUnavailable = input.scenario === "database-down";
const migrationsApplied =
  input.scenario !== "database-down" && input.scenario !== "migrations-missing";
const discordReady = input.scenario !== "discord-down";
const schedulerReady = input.scenario !== "scheduler-down";

if (databaseUnavailable) {
  Bun.env["DATABASE_URL"] = `file:${input.databasePath}/missing/database.db`;
} else {
  Bun.env["DATABASE_URL"] = `file:${input.databasePath}`;
  const database = new Database(input.databasePath, {
    create: true,
    strict: true,
  });
  try {
    database.run(`
      CREATE TABLE "_prisma_migrations" (
        "migration_name" TEXT NOT NULL,
        "finished_at" DATETIME,
        "rolled_back_at" DATETIME
      )
    `);
    if (migrationsApplied) {
      database.run(`
        INSERT INTO "_prisma_migrations" (
          "migration_name", "finished_at", "rolled_back_at"
        ) VALUES
          (
            '20260808000000_baseline',
            '2026-08-08T00:00:00.000Z',
            NULL
          ),
          (
            '20260808010000_birmel_3_runtime',
            '2026-08-08T00:01:00.000Z',
            NULL
          )
      `);
    }
  } finally {
    database.close();
  }
}

delete Bun.env["DATABASE_PATH"];
Bun.env["DISCORD_TOKEN"] = "health-test-token";
Bun.env["DISCORD_CLIENT_ID"] = "100000000000000001";
Bun.env["OPENAI_API_KEY"] = "health-test-openai-key";
Bun.env["TELEMETRY_ENABLED"] = "false";

const { getDiscordClient, destroyDiscordClient } =
  await import("@shepherdjerred/birmel/discord/client.ts");
const { disconnectPrisma } =
  await import("@shepherdjerred/birmel/database/index.ts");
const { startHealthServer, stopHealthServer } =
  await import("@shepherdjerred/birmel/health/server.ts");

Reflect.set(getDiscordClient(), "isReady", () => discordReady);
startHealthServer({
  port: input.port,
  isSchedulerStarted: () => schedulerReady,
});

try {
  const [liveResponse, readyResponse] = await Promise.all([
    fetch(`http://127.0.0.1:${String(input.port)}/live`),
    fetch(`http://127.0.0.1:${String(input.port)}/ready`),
  ]);
  const liveBody: unknown = await liveResponse.json();
  const readyBody: unknown = await readyResponse.json();
  console.log(
    JSON.stringify({
      healthFixture: true,
      live: { status: liveResponse.status, body: liveBody },
      ready: { status: readyResponse.status, body: readyBody },
    }),
  );
} finally {
  await stopHealthServer();
  await destroyDiscordClient();
  await disconnectPrisma();
}
