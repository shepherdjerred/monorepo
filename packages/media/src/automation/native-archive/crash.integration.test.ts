import { afterAll, expect, test } from "vitest";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { readyArchiveCleanup } from "./cleanup-test-support.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test.each(["purged", "native-archive-before-commit"])(
  "SIGKILL at %s preserves original archive evidence and cold retry commits exactly once",
  async (phase) => {
    const f = await readyArchiveCleanup(harness.database(), harness.cipher);
    directories.push(f.file.directory);
    const ports = await f.db.$queryRaw<
      { port: number }[]
    >`SELECT inet_server_port() AS port`;
    const port = z.int().positive().parse(ports[0]?.port);
    const config = path.join(f.file.directory, "archive-crash.json");
    const access = await f.context.files.plexAccess("movie");
    await writeFile(
      config,
      JSON.stringify({
        databaseUrl: `postgres://media@127.0.0.1:${String(port)}/postgres`,
        roots: f.context.files.roots,
        workerPodUid: f.context.workerPodUid,
        serverMachineId: access.serverMachineId,
        input: f.input,
        phase,
      }),
    );
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("fixtures/cleanup-crash.ts", import.meta.url)),
        config,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let diagnostics = "";
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    const [, signal] = await once(child, "exit");
    expect(signal, diagnostics).toBe("SIGKILL");
    const interrupted =
      await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.continuation.id },
      });
    expect(interrupted.executionEvidence).not.toBeNull();
    expect(interrupted.completion).toBeNull();
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({
        where: { id: f.first.assetId },
      }),
    ).toMatchObject({ state: "superseded" });
    await f.observeCleanup();
    expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
      status: "cleaned",
    });
    const completed =
      await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.continuation.id },
      });
    expect(completed.executionEvidence).toEqual(interrupted.executionEvidence);
    expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
      status: "cleaned",
    });
    expect(
      await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.continuation.id },
      }),
    ).toEqual(completed);
    expect(
      await readFile(nativeLocalPath(f.context, f.canonicalPath), "utf8"),
    ).toBe(f.published.content);
  },
);
