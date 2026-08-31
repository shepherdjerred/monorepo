import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, Connection, ScheduleNotFoundError } from "@temporalio/client";
import { ScoutScheduleOwnershipMemoSchema } from "@scout-for-lol/temporal";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  enqueueReportScheduleDeletion,
  enqueueReportScheduleUpsert,
} from "#src/reports/temporal-schedules.ts";
import {
  drainReportScheduleOutbox,
  reportScheduleExecutionMetadata,
} from "#src/reports/schedule-reconciler.ts";
import { scheduleMatchesReport } from "#src/reports/report-schedule-drift.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("report-schedule-real-server");
let server: ReturnType<typeof Bun.spawn> | undefined;
let connection: Connection | undefined;
let client: Client | undefined;
let directory: string | undefined;

function requireClient(): Client {
  if (client === undefined)
    throw new Error("Temporal test Client is not ready");
  return client;
}

async function unusedPort(): Promise<number> {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data() {
        return;
      },
    },
  });
  const port = listener.port;
  listener.stop(true);
  return port;
}

beforeAll(async () => {
  const executableResult = Bun.spawnSync(["mise", "which", "temporal"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (executableResult.exitCode !== 0) {
    throw new Error("mise could not resolve the pinned Temporal CLI");
  }
  const executable = executableResult.stdout.toString().trim();
  const port = await unusedPort();
  directory = await mkdtemp(path.join(tmpdir(), "scout-report-schedules-"));
  server = Bun.spawn(
    [
      executable,
      "--disable-config-file",
      "server",
      "start-dev",
      "--namespace",
      "dev",
      "--headless",
      "--ip",
      "127.0.0.1",
      "--port",
      port.toString(),
      "--db-filename",
      path.join(directory, "temporal.db"),
      // Match the cluster's namespace-init job (homelab cdk8s
      // createTemporalNamespaceInitJob): buildExecutionStartMetadata
      // (execution-metadata.ts) attaches these as typed search attributes on
      // every schedule-started workflow, and the server rejects an unmapped
      // attribute rather than silently dropping it.
      "--search-attribute",
      "Environment=Keyword",
      "--search-attribute",
      "Domain=Keyword",
      "--search-attribute",
      "Trigger=Keyword",
      "--search-attribute",
      "ReleaseCommit=Keyword",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const address = `127.0.0.1:${port.toString()}`;
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Temporal dev server exited with ${server.exitCode.toString()}`,
      );
    }
    try {
      connection = await Connection.connect({
        address,
        connectTimeout: 500,
      });
      client = new Client({ connection, namespace: "dev" });
      return;
    } catch (error: unknown) {
      lastError = error;
      await Bun.sleep(100);
    }
  }
  throw new Error("Temporal dev server did not become ready", {
    cause: lastError,
  });
}, 30_000);

beforeEach(async () => {
  await prisma.reportScheduleOutbox.deleteMany();
  await prisma.reportRun.deleteMany();
  await prisma.report.deleteMany();
  const temporal = requireClient();
  for await (const summary of temporal.schedule.list()) {
    if (summary.scheduleId.startsWith("scout-dev-report-")) {
      await temporal.schedule.getHandle(summary.scheduleId).delete();
    }
  }
});

afterAll(async () => {
  await prisma.reportScheduleOutbox.deleteMany();
  await prisma.reportRun.deleteMany();
  await prisma.report.deleteMany();
  await prisma.$disconnect();
  await connection?.close();
  if (server?.exitCode === null) {
    server.kill();
    await server.exited;
  }
  if (directory !== undefined) await rm(directory, { recursive: true });
});

test("reconciles report Schedules closed-world while preserving a human pause", async () => {
  const temporal = requireClient();
  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.report.create({
      data: {
        serverId: testGuildId("880000000000000101"),
        ownerId: testAccountId("880000000000000102"),
        channelId: testChannelId("880000000000000103"),
        title: "Real Temporal Schedule",
        queryText:
          "SELECT player, games FROM match GROUP BY player RENDER table",
        cronExpression: "0 8 * * *",
        scheduleTimezone: "America/Los_Angeles",
        nextScheduledRunAt: new Date(Date.now() + 86_400_000),
        createdTime: new Date(),
        updatedTime: new Date(),
      },
    });
    await enqueueReportScheduleUpsert(tx, created.id, created.revision);
    return created;
  });

  await expect(
    drainReportScheduleOutbox(temporal, "dev", prisma),
  ).resolves.toEqual({ processed: 1, remaining: 0 });
  const scheduleId = `scout-dev-report-${report.id.toString()}`;
  const handle = temporal.schedule.getHandle(scheduleId);
  const created = await handle.describe();
  expect(ScoutScheduleOwnershipMemoSchema.parse(created.memo)).toEqual({
    owner: "scout-for-lol",
    stage: "dev",
    reportId: report.id.toString(),
    schemaVersion: 1,
  });
  expect(created.action.taskQueue).toBe("scout-dev");
  expect(created.policies.overlap).toBe("BUFFER_ONE");
  expect(created.policies.catchupWindow).toBe(3_600_000);

  await handle.pause("operator maintenance");
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.report.update({
      where: { id: report.id },
      data: {
        cronExpression: "30 9 * * *",
        revision: { increment: 1 },
        updatedTime: new Date(),
      },
    });
    await enqueueReportScheduleUpsert(tx, next.id, next.revision);
    return next;
  });
  await drainReportScheduleOutbox(temporal, "dev", prisma);
  const reconciled = await handle.describe();
  expect(reconciled.state.paused).toBe(true);
  expect(reconciled.action.args).toEqual([
    {
      stage: "dev",
      reportId: report.id.toString(),
      revision: updated.revision,
      source: "schedule",
    },
  ]);

  await handle.update((previous) => ({
    spec: {
      cronExpressions: ["30 9 * * 1"],
      timezone: "America/Los_Angeles",
    },
    action: {
      type: "startWorkflow",
      workflowType: "scoutReportRunWorkflow",
      taskQueue: "wrong-queue",
      args: [
        {
          stage: "dev",
          reportId: report.id.toString(),
          revision: updated.revision,
          source: "schedule",
        },
      ],
      workflowExecutionTimeout: 15 * 60 * 1000,
    },
    policies: previous.policies,
    state: previous.state,
  }));
  const drifted = await handle.describe();
  const desired = {
    stage: "dev" as const,
    reportId: report.id,
    revision: updated.revision,
    cronExpression: "30 9 * * *",
    timezone: "America/Los_Angeles",
    executionMetadata: reportScheduleExecutionMetadata("dev"),
  };
  expect(scheduleMatchesReport(drifted, desired)).toBe(false);
  await drainReportScheduleOutbox(temporal, "dev", prisma);
  const repaired = await handle.describe();
  expect(scheduleMatchesReport(repaired, desired)).toBe(true);
  expect(repaired.state.paused).toBe(true);

  await prisma.$transaction(async (tx) => {
    await enqueueReportScheduleDeletion(tx, report.id, updated.revision + 1);
    await tx.report.delete({ where: { id: report.id } });
  });
  await drainReportScheduleOutbox(temporal, "dev", prisma);
  await expect(handle.describe()).rejects.toBeInstanceOf(ScheduleNotFoundError);
});

test("alerts but does not delete a prefix match without the strict ownership memo", async () => {
  const temporal = requireClient();
  const scheduleId = "scout-dev-report-999999";
  await temporal.schedule.create({
    scheduleId,
    spec: { intervals: [{ every: 60_000 }] },
    action: {
      type: "startWorkflow",
      workflowType: "unknownWorkflow",
      taskQueue: "unknown-queue",
    },
    memo: { owner: "someone-else" },
  });

  await drainReportScheduleOutbox(temporal, "dev", prisma);
  await expect(
    temporal.schedule.getHandle(scheduleId).describe(),
  ).resolves.toMatchObject({ scheduleId });
});
