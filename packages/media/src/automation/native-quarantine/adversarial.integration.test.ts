import { afterAll, expect, test, vi } from "vitest";
import { rm, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { automationTestHarness } from "#testing/automation.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { nativeQuarantineFixture } from "./test-fixture.ts";
import { prepareNativeQuarantineFiles } from "./files.ts";
import { applyPreparedQuarantine } from "./apply.ts";
import { z } from "zod";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const f = await nativeQuarantineFixture(
    harness.database(),
    harness.context().cipher,
  );
  directories.push(f.file.directory);
  return f;
}

test.each(["move-unlinked", "native-quarantine-restored-before-commit"])(
  "SIGKILL at %s retains immutable execution identity and cold recovery commits once",
  async (phase) => {
    const f = await fixture();
    const continuation = await f.apply();
    const input = await f.positiveRestore();
    const ports = await f.db.$queryRaw<
      { port: number }[]
    >`SELECT inet_server_port() AS port`;
    const port = z.int().positive().parse(ports[0]?.port);
    const config = path.join(f.file.directory, "crash-input.json");
    await writeFile(
      config,
      JSON.stringify({
        databaseUrl: `postgres://media@127.0.0.1:${String(port)}/postgres`,
        roots: f.context.files.roots,
        workerPodUid: f.context.workerPodUid,
        serverMachineId: z
          .string()
          .min(1)
          .parse(f.file.context.serverMachineId),
        input,
        phase,
      }),
    );
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("fixtures/restore-crash.ts", import.meta.url)),
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
      await f.db.nativeQuarantineContinuation.findUniqueOrThrow({
        where: { id: continuation.id },
      });
    expect(interrupted).toMatchObject({
      state: "restoring",
      restoration: null,
    });
    expect(interrupted.executionEvidence).not.toBeNull();
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ state: "quarantined", version: 2 });
    expect(await f.activities.restoreNativeQuarantineFiles(input)).toEqual({
      status: "restored",
    });
    expect(
      await readFile(
        path.join(f.file.roots.library, f.published.entry.libraryPath),
        "utf8",
      ),
    ).toBe(f.published.content);
  },
  20_000,
);

test("an actual cancellation committed during content hashing revokes restore without moving bytes", async () => {
  const f = await fixture();
  await f.apply();
  const input = await f.positiveRestore();
  const claim = await f.db.mediaRequest.findFirstOrThrow({
    where: { mediaId: f.file.media.id, active: true },
  });
  let cancelled = false;
  f.context.files.checkpoint = async (phase) => {
    if (phase !== "native-quarantine-restore-hashing" || cancelled) return;
    cancelled = true;
    await new PrismaMediaCommands(f.db, { keepDays: 30 }).cancelRequest(
      f.file.user,
      crypto.randomUUID(),
      claim.id,
      claim.version,
    );
  };
  expect(await f.activities.restoreNativeQuarantineFiles(input)).toMatchObject({
    status: "protected",
  });
  expect(cancelled).toBe(true);
  expect(await f.bytes()).toBe(f.published.content);
  await expect(
    readFile(path.join(f.file.roots.library, f.published.entry.libraryPath)),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("a newer coordinator after committed execution evidence fences the old restore caller", async () => {
  const f = await fixture();
  await f.apply();
  const input = await f.positiveRestore();
  let replaced = false;
  f.context.files.checkpoint = async (phase) => {
    if (phase !== "native-quarantine-execution-committed" || replaced) return;
    replaced = true;
    await f.positiveRestore();
  };
  expect(await f.activities.restoreNativeQuarantineFiles(input)).toMatchObject({
    status: "protected",
    reason: "native_quarantine_coordinator_changed",
  });
  expect(await f.bytes()).toBe(f.published.content);
});

test("a substituted canonical ancestor after review cannot receive physical ownership", async () => {
  const f = await fixture();
  const approval = await f.approve();
  await f.observe();
  const prepared = await prepareNativeQuarantineFiles(f.context, {
    planId: f.planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  const library = f.file.roots.library;
  await rename(library, `${library}-original`);
  // Rename the original tree back under a new directory is insufficient: the parent inode itself is bound.
  const { mkdir, readdir } = await import("node:fs/promises");
  await mkdir(library);
  for (const entry of await readdir(`${library}-original`))
    await rename(
      path.join(`${library}-original`, entry),
      path.join(library, entry),
    );
  await expect(
    applyPreparedQuarantine(
      f.context,
      { planId: f.planId, operationId: z.uuid().parse(approval.operationId) },
      prepared,
    ),
  ).rejects.toThrow("ancestor changed");
  expect(
    await f.db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
});

test("lease expiry after physical restoration rolls back DB authority and cold recovery uses the same exact journal", async () => {
  const f = await fixture();
  const continuation = await f.apply();
  const input = await f.positiveRestore();
  const expires = Date.now() + 10_000;
  await f.db.legacyWriterLease.update({
    where: { id: "singleton" },
    data: { expiresAt: new Date(expires) },
  });
  let clock: { mockRestore: () => void } | undefined;
  f.context.files.checkpoint = (phase) => {
    if (phase === "native-quarantine-restored-before-commit")
      clock = vi.spyOn(Date, "now").mockReturnValue(expires + 1);
    return Promise.resolve();
  };
  try {
    await expect(
      f.activities.restoreNativeQuarantineFiles(input),
    ).rejects.toThrow("Media storage authority is absent, stale");
  } finally {
    clock?.mockRestore();
  }
  expect(
    await f.db.nativeQuarantineContinuation.findUniqueOrThrow({
      where: { id: continuation.id },
    }),
  ).toMatchObject({ state: "restoring", restoration: null });
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ state: "quarantined", version: 2 });
  f.context.files.checkpoint = () => Promise.resolve();
  expect(await f.activities.restoreNativeQuarantineFiles(input)).toEqual({
    status: "restored",
  });
});

test("network authority expiring while awaiting filesystem validation cannot commit native ownership", async () => {
  const f = await fixture();
  const approval = await f.approve();
  await f.observe();
  const prepared = await prepareNativeQuarantineFiles(f.context, {
    planId: f.planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  const verify = f.context.files.verifyPlexExclusion;
  if (verify === undefined) throw new Error("Fixture exclusion guard missing");
  let clock: { mockRestore: () => void } | undefined;
  const future = Date.now() + 120_001;
  let validationReached = false;
  f.context.files.verifyPlexExclusion = async (roots) => {
    await verify(roots);
    validationReached = true;
    clock ??= vi.spyOn(Date, "now").mockReturnValue(future);
  };
  try {
    await expect(
      applyPreparedQuarantine(
        f.context,
        { planId: f.planId, operationId: z.uuid().parse(approval.operationId) },
        prepared,
      ),
    ).rejects.toMatchObject({
      code: "verification_expired",
      reason: "verification_expired",
    });
  } finally {
    clock?.mockRestore();
  }
  expect(validationReached).toBe(true);
  expect(
    await f.db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ ownershipEpoch: 0, version: 1 });
});
