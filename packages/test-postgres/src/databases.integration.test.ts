import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createEmptyTestDatabase,
  createTemplateTestDatabase,
  ensureSharedPostgres,
  hostProcessProbe,
  listManagedDatabases,
  ownerCommentSql,
  pruneStaleTemplateDatabases,
  psqlMaintenance,
  psqlMaintenanceCommandsAsync,
  STALE_TEMPLATE_MAX_AGE_MS,
  SWEEP_GRACE_MS,
  sweepStaleTestDatabases,
} from "./index.ts";

let migrationsDir = "";
const createdTemplates: string[] = [];

beforeAll(async () => {
  ensureSharedPostgres();
  migrationsDir = await mkdtemp(path.join(tmpdir(), "test-pg-migrations-"));
  const firstMigration = path.join(migrationsDir, "20261115000000_init");
  await Bun.write(
    path.join(firstMigration, "migration.sql"),
    "CREATE TABLE items (id text PRIMARY KEY, label text NOT NULL);\nINSERT INTO items (id, label) VALUES ('seed', 'from-template');\n",
    { createPath: true },
  );
  await writeFile(path.join(migrationsDir, "README.txt"), "fixture\n");
});

afterAll(async () => {
  for (const templateName of createdTemplates) {
    try {
      await psqlMaintenanceCommandsAsync([
        `ALTER DATABASE "${templateName}" WITH IS_TEMPLATE FALSE ALLOW_CONNECTIONS TRUE`,
        `DROP DATABASE IF EXISTS "${templateName}"`,
      ]);
    } catch {
      // Best-effort template test cleanup.
    }
  }
  if (migrationsDir !== "") {
    await rm(migrationsDir, { recursive: true, force: true });
  }
});

describe("shared PostgreSQL template & empty database harness", () => {
  test("builds template once under pg_advisory_lock across concurrent callers and clones fast", async () => {
    let populateCalls = 0;
    const uniqueExtra = crypto.randomUUID();

    const clones = await Promise.all(
      [1, 2, 3, 4].map(() =>
        createTemplateTestDatabase({
          prefix: "delivery",
          user: "delivery",
          migrationsDir,
          extraHashInputs: [uniqueExtra],
          populate: async (templateUrl) => {
            populateCalls += 1;
            await psqlMaintenanceCommandsAsync(
              [
                "CREATE TABLE widgets (id serial PRIMARY KEY, name text NOT NULL)",
                "INSERT INTO widgets (name) VALUES ('seeded-once')",
              ],
              { adminUrl: templateUrl },
            );
          },
        }),
      ),
    );

    const firstClone = clones[0];
    if (firstClone !== undefined) {
      createdTemplates.push(firstClone.templateName);
    }

    expect(populateCalls).toBe(1);
    for (const clone of clones) {
      expect(clone.dbName).toMatch(/^delivery_test_[a-f0-9]{32}$/u);
      const count = psqlMaintenance("SELECT count(*) FROM widgets", {
        adminUrl: clone.url,
      });
      expect(count).toBe("1");
      await clone.drop();
    }

    if (firstClone !== undefined) {
      const templateRow = listManagedDatabases(
        `d.datname = '${firstClone.templateName}'`,
      )[0];
      expect(templateRow?.isTemplate).toBe(true);
      expect(templateRow?.allowConnections).toBe(false);
    }
  });

  test("creates empty _mig_ database for partial migrations and stamps monorepo-test-owner/v1", async () => {
    const empty = await createEmptyTestDatabase({
      prefix: "media",
      user: "media",
    });
    try {
      expect(empty.dbName).toMatch(/^media_mig_[a-f0-9]{32}$/u);
      const row = listManagedDatabases(`d.datname = '${empty.dbName}'`)[0];
      expect(row?.record.kind).toBe("owned");
      await psqlMaintenanceCommandsAsync(
        ["CREATE TABLE partial_step (step int PRIMARY KEY)"],
        { adminUrl: empty.url },
      );
      expect(
        psqlMaintenance("SELECT count(*) FROM partial_step", {
          adminUrl: empty.url,
        }),
      ).toBe("0");
    } finally {
      await empty.drop();
    }
  });

  test("sweeps dead-owner databases across prefixes while keeping live-owner databases", async () => {
    const sleeper = Bun.spawn(["sleep", "120"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const processStart = hostProcessProbe.startTime(sleeper.pid);
    if (processStart === undefined) {
      sleeper.kill();
      throw new Error("Could not read sleeper processStart");
    }

    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const dbNames = [`tracker_test_${suffix}`, `media_mig_${suffix}`] as const;

    try {
      for (const name of dbNames) {
        psqlMaintenance(`CREATE DATABASE "${name}"`);
        psqlMaintenance(
          ownerCommentSql(name, {
            host: hostProcessProbe.host,
            pid: sleeper.pid,
            processStart,
            createdAt: Date.now() - SWEEP_GRACE_MS - 60_000,
          }),
        );
      }

      sweepStaleTestDatabases();
      for (const name of dbNames) {
        expect(
          psqlMaintenance(
            `SELECT 1 FROM pg_database WHERE datname = '${name}'`,
          ),
        ).toBe("1");
      }

      sleeper.kill();
      await sleeper.exited;

      const summary = sweepStaleTestDatabases();
      for (const name of dbNames) {
        expect(summary.dropped).toContain(name);
        expect(
          psqlMaintenance(
            `SELECT 1 FROM pg_database WHERE datname = '${name}'`,
          ),
        ).toBe("");
      }
    } finally {
      sleeper.kill();
      await sleeper.exited;
      for (const name of dbNames) {
        psqlMaintenance(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
    }
  });

  test("prunes stale templates >24h old with 0 connections while keeping <24h templates", async () => {
    const suffixOld = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const suffixFresh = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const oldTemplate = `tracker_template_old_${suffixOld}`;
    const freshTemplate = `tracker_template_new_${suffixFresh}`;
    const currentTemplate = `tracker_template_cur_${suffixFresh}`;
    createdTemplates.push(oldTemplate, freshTemplate);

    const selfStart = hostProcessProbe.startTime(process.pid) ?? "now";
    psqlMaintenance(`CREATE DATABASE "${oldTemplate}"`);
    psqlMaintenance(
      ownerCommentSql(oldTemplate, {
        host: hostProcessProbe.host,
        pid: process.pid,
        processStart: selfStart,
        createdAt: Date.now() - STALE_TEMPLATE_MAX_AGE_MS - 60_000,
        templateHash: "0".repeat(64),
      }),
    );
    psqlMaintenance(
      `ALTER DATABASE "${oldTemplate}" WITH IS_TEMPLATE TRUE ALLOW_CONNECTIONS FALSE`,
    );

    psqlMaintenance(`CREATE DATABASE "${freshTemplate}"`);
    psqlMaintenance(
      ownerCommentSql(freshTemplate, {
        host: hostProcessProbe.host,
        pid: process.pid,
        processStart: selfStart,
        createdAt: Date.now() - 60_000,
        templateHash: "1".repeat(64),
      }),
    );
    psqlMaintenance(
      `ALTER DATABASE "${freshTemplate}" WITH IS_TEMPLATE TRUE ALLOW_CONNECTIONS FALSE`,
    );

    const pruned = await pruneStaleTemplateDatabases({
      prefix: "tracker",
      currentTemplateName: currentTemplate,
    });

    expect(pruned).toContain(oldTemplate);
    expect(pruned).not.toContain(freshTemplate);
    expect(
      psqlMaintenance(
        `SELECT 1 FROM pg_database WHERE datname = '${oldTemplate}'`,
      ),
    ).toBe("");
    expect(
      psqlMaintenance(
        `SELECT 1 FROM pg_database WHERE datname = '${freshTemplate}'`,
      ),
    ).toBe("1");
  });
});
