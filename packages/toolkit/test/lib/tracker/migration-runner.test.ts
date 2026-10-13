import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { ImportRecordSchema } from "@shepherdjerred/tracker/contract";
import { trackerClient } from "#lib/tracker/client.ts";
import { hash } from "#lib/tracker/migration/files.ts";
import { runImport } from "#lib/tracker/migration/runner.ts";
import { planMigration } from "#lib/tracker/migration/normalize.ts";
import {
  migrationActor,
  migrationFixture,
  fileBytes,
} from "./migration-fixture.ts";

const directories: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function exportDirectory() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "tracker-migration-test-"),
  );
  directories.push(directory);
  const snapshot = migrationFixture();
  const body = JSON.stringify(snapshot);
  await mkdir(path.join(directory, "files"));
  await writeFile(path.join(directory, "export.json"), body);
  await writeFile(path.join(directory, "export.sha256"), hash(body));
  await writeFile(path.join(directory, "files", hash(fileBytes)), fileBytes);
  return directory;
}

function destination(
  options: { interrupt?: boolean; collision?: boolean } = {},
) {
  const applied = new Set<string>();
  const requests: string[] = [];
  let interrupted = false;
  let writes = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const procedure = new URL(request.url).pathname.slice("/trpc/".length);
      requests.push(procedure);
      let data: unknown;
      if (procedure === "meta.bootstrap") data = { writesEnabled: false };
      else if (procedure === "issues.list")
        data = {
          items: options.collision
            ? [{ identifier: "AI-186", externalRef: null }]
            : [],
          nextCursor: null,
        };
      else {
        const record = ImportRecordSchema.parse(await request.json());
        const key = record.entityType + ":" + record.externalId;
        const unchanged = applied.has(key);
        applied.add(key);
        if (!unchanged) writes++;
        if (!interrupted && writes === 3 && options.interrupt) {
          interrupted = true;
          return Response.json(
            {
              error: {
                message: "Lost response after commit",
                code: -32_603,
                data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
              },
            },
            { status: 500 },
          );
        }
        data = {
          status: unchanged ? "unchanged" : "imported",
          destinationId: key,
        };
      }
      return Response.json({ result: { data } });
    },
  });
  servers.push(server);
  return {
    client: trackerClient(server.url.toString()),
    requests,
    writes: () => writes,
  };
}

test("dry-run and corrupt-file validation complete without destination calls", async () => {
  const directory = await exportDirectory();
  const target = destination();
  const options = {
    directory,
    actor: migrationActor,
    client: target.client,
    dryRun: true,
  };
  expect(await runImport(options)).toMatchObject({
    dryRun: true,
    counts: { issue: 2, attachment: 2 },
  });
  expect(target.requests).toEqual([]);
  await writeFile(path.join(directory, "files", hash(fileBytes)), "corrupt");
  await expect(runImport({ ...options, dryRun: false })).rejects.toThrow(
    "checksum mismatch",
  );
  expect(target.requests).toEqual([]);
});

test("a native issue collision is rejected before any mutation", async () => {
  const directory = await exportDirectory();
  const target = destination({ collision: true });
  await expect(
    runImport({
      directory,
      actor: migrationActor,
      client: target.client,
      dryRun: false,
    }),
  ).rejects.toThrow("native or conflicting issue");
  expect(target.writes()).toBe(0);
});

test("an ambiguous response resumes through server idempotency and reruns without new writes", async () => {
  const directory = await exportDirectory();
  const target = destination({ interrupt: true });
  const options = {
    directory,
    actor: migrationActor,
    client: target.client,
    dryRun: false,
  };
  await expect(runImport(options)).rejects.toThrow(
    "Lost response after commit",
  );
  const plan = await planMigration(migrationFixture(), migrationActor);
  expect(await runImport(options)).toMatchObject({
    imported: plan.records.length - 3,
    unchanged: 3,
  });
  const first = target.writes();
  expect(await runImport(options)).toMatchObject({
    imported: 0,
    unchanged: plan.records.length,
  });
  expect(target.writes()).toBe(first);
});
