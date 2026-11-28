import path from "node:path";
import {
  currentDatabaseOwner,
  databaseUrlFromAdmin,
  ensureSharedPostgres,
  envWithPostgresBin,
  ownerCommentSql,
  psqlMaintenanceCommandsAsync,
  runCommandAsync,
} from "@shepherdjerred/test-postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPostgresExperimentStore } from "./postgres.ts";
import type { ExperimentStore, ExperimentWrite } from "./store.ts";

const dbName = `tracker_test_experiments_${crypto.randomUUID().replaceAll("-", "")}`;
const packageRoot = path.resolve(import.meta.dir, "..");
let adminUrl: string | undefined;
let store: ExperimentStore | undefined;

beforeAll(async () => {
  adminUrl = ensureSharedPostgres().superUrl;
  const connection = databaseUrlFromAdmin(adminUrl, dbName);
  await psqlMaintenanceCommandsAsync(
    [
      `CREATE DATABASE "${dbName}"`,
      ownerCommentSql(dbName, currentDatabaseOwner()),
    ],
    { adminUrl },
  );
  const migrate = await runCommandAsync(["bun", "run", "migrate:deploy"], {
    cwd: packageRoot,
    env: envWithPostgresBin({ DATABASE_URL: connection }),
  });
  if (migrate.exitCode !== 0)
    throw new Error(
      `Experiments migration failed: ${migrate.stderr || migrate.stdout}`,
    );
  store = createPostgresExperimentStore(connection);
});

afterAll(async () => {
  await store?.close();
  if (adminUrl !== undefined) {
    await psqlMaintenanceCommandsAsync(
      [`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`],
      { adminUrl },
    );
  }
});

it("atomically persists concurrent retries, retires stale revisions, and queries due records", async () => {
  const repo = store;
  if (repo === undefined) throw new Error("Test database is unavailable");
  const write = (command: ExperimentWrite) =>
    repo.write(command, {
      actor: "toolkit",
      at: "2026-11-27T08:00:00.000Z",
      today: "2026-11-27",
    });
  const create = {
    kind: "create",
    input: {
      requestId: crypto.randomUUID(),
      owner: "operator",
      title: "CLI speed",
      reviewDate: "2026-11-27",
      plan: {
        change: "Faster reads",
        hypothesis: "Better latency",
        scope: "CLI",
        successCriteria: "10% faster",
        measurementMethod: "Timing",
      },
    },
  } as const;
  const [created, duplicate] = await Promise.all([
    write(create),
    write(create),
  ]);
  expect(duplicate).toEqual(created);
  expect(await repo.list({}, "2026-11-27")).toHaveLength(1);

  const start = {
    id: created.id,
    command: {
      kind: "start",
      input: { requestId: crypto.randomUUID(), expectedRevision: 1 },
    },
  } as const;
  const [running, repeat] = await Promise.all([write(start), write(start)]);
  expect(repeat).toEqual(running);
  expect(running.timeline).toHaveLength(2);
  expect(await write(create)).toEqual(created);
  expect(await repo.countDue("2026-11-26")).toBe(0);
  expect(await repo.countDue("2026-11-27")).toBe(1);
  expect(await repo.list({ view: "due", q: "CLI" }, "2026-11-27")).toHaveLength(
    1,
  );

  const evidence = {
    id: running.id,
    command: {
      kind: "evidence",
      input: {
        expectedRevision: 2,
        note: "Measurements",
        requestId: crypto.randomUUID(),
      },
    },
  } as const;
  const conflicting = {
    ...evidence,
    command: {
      ...evidence.command,
      input: { ...evidence.command.input, requestId: crypto.randomUUID() },
    },
  };
  const results = await Promise.allSettled([
    write(evidence),
    write(conflicting),
  ]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(results.find((item) => item.status === "rejected")).toMatchObject({
    reason: { code: "revision_conflict" },
  });
  expect(await repo.find(running.id, "2026-11-27")).toMatchObject({
    revision: 3,
    timeline: expect.arrayContaining([
      expect.objectContaining({ kind: "evidence" }),
    ]),
  });
  expect(await repo.ping()).toBe(true);
});
