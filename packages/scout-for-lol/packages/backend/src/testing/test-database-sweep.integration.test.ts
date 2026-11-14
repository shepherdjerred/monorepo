import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { psqlMaintenance } from "#src/testing/postgres-server.ts";
import {
  hostProcessProbe,
  ownerCommentSql,
} from "#src/testing/test-database-owner.ts";
import { sweepStaleTestDatabases } from "#src/testing/test-template.ts";

// Stands in for another run's live test process.
let owner: ReturnType<typeof Bun.spawn> | undefined;
const databaseName = `scout_test_${Date.now().toString()}_${Math.random().toString(36).slice(2, 6)}_sweep_live_owner`;

function databaseExists(): boolean {
  return (
    psqlMaintenance(
      `SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`,
    ) === "1"
  );
}

beforeAll(() => {
  owner = Bun.spawn(["sleep", "300"], { stdout: "ignore", stderr: "ignore" });
  const processStart = hostProcessProbe.startTime(owner.pid);
  if (processStart === undefined) {
    throw new Error(
      `Cannot read the start time of pid ${owner.pid.toString()}`,
    );
  }
  // sweepStaleTestDatabases ensures the server; create only after it has run.
  sweepStaleTestDatabases();
  psqlMaintenance(`CREATE DATABASE "${databaseName}"`);
  psqlMaintenance(
    ownerCommentSql(databaseName, {
      host: hostProcessProbe.host,
      pid: owner.pid,
      processStart,
      // Far past the grace period: only the live owner protects it.
      createdAt: Date.now() - 60 * 60 * 1000,
    }),
  );
});

afterAll(async () => {
  owner?.kill();
  await owner?.exited;
  psqlMaintenance(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
});

describe("sweepStaleTestDatabases", () => {
  test("keeps an old database whose owner process is still alive", () => {
    sweepStaleTestDatabases();
    expect(databaseExists()).toBe(true);
  });

  test("drops it once that owner process has exited", async () => {
    owner?.kill();
    await owner?.exited;
    sweepStaleTestDatabases();
    expect(databaseExists()).toBe(false);
  });
});
