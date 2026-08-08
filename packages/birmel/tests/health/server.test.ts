import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

type Scenario =
  | "database-down"
  | "migrations-missing"
  | "discord-down"
  | "scheduler-down"
  | "ready";

const HealthResultSchema = z.object({
  healthFixture: z.literal(true),
  live: z.object({
    status: z.number().int(),
    body: z.object({ live: z.boolean() }),
  }),
  ready: z.object({
    status: z.number().int(),
    body: z.object({
      ready: z.boolean(),
      checks: z.object({
        database: z.boolean(),
        migrations: z.boolean(),
        discord: z.boolean(),
        scheduler: z.boolean(),
      }),
    }),
  }),
});

const directory = await mkdtemp(path.join(tmpdir(), "birmel-health-"));
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function availablePort(): Promise<number> {
  const reservation = Bun.serve({
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = z.number().int().positive().parse(reservation.port);
  await reservation.stop(true);
  return port;
}

async function runScenario(scenario: Scenario) {
  const scenarioDirectory = path.join(directory, scenario);
  await mkdir(scenarioDirectory, { recursive: true });
  const databasePath = path.join(scenarioDirectory, "health.db");
  const port = await availablePort();
  const child = Bun.spawn(
    [
      "bun",
      "tests/health/health-fixture.ts",
      scenario,
      databasePath,
      String(port),
    ],
    {
      cwd: packageRoot,
      env: Bun.env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Health fixture ${scenario} failed with ${String(exitCode)}\n${stdout}\n${stderr}`,
    );
  }
  const resultLine = stdout
    .split("\n")
    .find((line) => line.includes('"healthFixture":true'));
  if (resultLine == null) {
    throw new Error(`Health fixture ${scenario} returned no result\n${stdout}`);
  }
  const parsed: unknown = JSON.parse(resultLine);
  return HealthResultSchema.parse(parsed);
}

describe("Birmel health endpoints", () => {
  test("keeps liveness independent of dependency readiness", async () => {
    const result = await runScenario("database-down");

    expect(result.live).toEqual({ status: 200, body: { live: true } });
    expect(result.ready.status).toBe(503);
    expect(result.ready.body).toEqual({
      ready: false,
      checks: {
        database: false,
        migrations: false,
        discord: true,
        scheduler: true,
      },
    });
  });

  test("requires all migrations to be complete", async () => {
    const result = await runScenario("migrations-missing");

    expect(result.ready.status).toBe(503);
    expect(result.ready.body.checks).toEqual({
      database: true,
      migrations: false,
      discord: true,
      scheduler: true,
    });
  });

  test("requires Discord readiness", async () => {
    const result = await runScenario("discord-down");

    expect(result.ready.status).toBe(503);
    expect(result.ready.body.checks).toEqual({
      database: true,
      migrations: true,
      discord: false,
      scheduler: true,
    });
  });

  test("requires scheduler startup", async () => {
    const result = await runScenario("scheduler-down");

    expect(result.ready.status).toBe(503);
    expect(result.ready.body.checks).toEqual({
      database: true,
      migrations: true,
      discord: true,
      scheduler: false,
    });
  });

  test("reports ready only when every readiness check passes", async () => {
    const result = await runScenario("ready");

    expect(result.live.status).toBe(200);
    expect(result.ready).toEqual({
      status: 200,
      body: {
        ready: true,
        checks: {
          database: true,
          migrations: true,
          discord: true,
          scheduler: true,
        },
      },
    });
  });
});
