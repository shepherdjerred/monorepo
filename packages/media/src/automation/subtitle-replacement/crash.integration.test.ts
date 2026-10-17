import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { test, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { FileLockError } from "#filesystem/advisory-lock.ts";
import { replacementHarness } from "./test-fixture.ts";

const harness = replacementHarness();
async function killAt(
  f: Awaited<ReturnType<typeof harness.setup>>,
  input: { operationId: string; replacementId: string },
  phase: string,
  mode: "apply" | "reconcile" | "cleanup" = "apply",
) {
  const rows = await f.db.$queryRaw`SELECT inet_server_port() AS port`;
  const port = z.array(z.object({ port: z.int() })).parse(rows)[0]?.port;
  if (port === undefined) throw new Error("Fixture port missing");
  const child = spawn(
    process.execPath,
    [
      "run",
      fileURLToPath(new URL("crash.fixture.ts", import.meta.url)),
      JSON.stringify({
        ...input,
        phase,
        mode,
        roots: f.roots,
        databaseUrl: `postgres://media@127.0.0.1:${String(port)}/postgres`,
        now: f.context.now?.().toISOString(),
      }),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Worker never reached crash checkpoint")),
        10_000,
      );
      let output = "";
      child.stdout.on("data", (bytes: Buffer) => {
        output += bytes.toString();
        if (output.includes("ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on("data", (bytes: Buffer) => {
        output += bytes.toString();
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Fixture exited: ${output}`));
      });
    });
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
}
async function retry<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (
        !(error instanceof FileLockError) ||
        error.kind !== "busy" ||
        attempt > 20
      )
        throw error;
      await delay(10);
    }
  }
}

test.each([
  "previous-version-preserved",
  "published",
  "subtitle-replacement-before-receipt",
])(
  "real worker kill at %s recovers exact bytes and one receipt",
  async (phase) => {
    const f = await harness.setup();
    const input = await f.approve();
    await killAt(f, input, phase);
    expect(await f.row()).toMatchObject({ receipt: null });
    expect(
      await retry(() => f.activities().applySubtitleReplacement(input)),
    ).toEqual({ state: "applied" });
    expect(await readFile(f.filename, "utf8")).toBe(f.newText);
    expect(
      await f.db.subtitleReplacementReceipt.count({
        where: { replacementId: f.replacementId },
      }),
    ).toBe(1);
  },
  20_000,
);

test("real worker kill during rollback is reconciled without reviving the candidate", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  await killAt(f, input, "published");
  await f.db.mediaIntent.update({
    where: targetWhere(defaultScope(f.media.id)),
    data: { desiredPresence: false, generation: { increment: 1 } },
  });
  const current = await f.row();
  const command = await f.service.reconcile(
    f.owner,
    crypto.randomUUID(),
    f.replacementId,
    { expectedVersion: current.version },
  );
  const reconcile = {
    replacementId: f.replacementId,
    operationId: z.uuid().parse(command.operationId),
  };
  await killAt(f, reconcile, "rollback-published", "reconcile");
  expect(
    await retry(() => f.activities().reconcileSubtitleReplacement(reconcile)),
  ).toEqual({ state: "rolled_back" });
  expect(await readFile(f.filename, "utf8")).toBe(f.oldText);
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: f.candidateId },
    }),
  ).toMatchObject({ state: "failed", qualityStatus: "accepted" });
}, 20_000);

test("real worker kill before durable staging identity leaves unknown artifacts protected", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  await killAt(f, input, "copying");
  expect(await f.activities().applySubtitleReplacement(input)).toMatchObject({
    state: "protected",
    reason: "subtitle_replacement_artifact_ownership_unconfirmed",
  });
  expect(await f.row()).toMatchObject({ reservationActive: true });
  expect(await readFile(f.filename, "utf8")).toBe(f.oldText);
}, 20_000);

test("real worker kill after cleanup unlink resumes from its exact artifact journal", async () => {
  const f = await harness.setup();
  expect(
    await f.activities().applySubtitleReplacement(await f.approve()),
  ).toEqual({ state: "applied" });
  f.advance(8 * 86_400_000);
  const operation = await f.db.operation.create({
    data: {
      kind: "cleanup_subtitle_replacement",
      targetId: f.replacementId,
      payload: { replacementId: f.replacementId },
    },
  });
  const input = { replacementId: f.replacementId, operationId: operation.id };
  await killAt(f, input, "subtitle-artifact-unlinked", "cleanup");
  const interrupted = await f.row();
  expect(interrupted.cleanupState).not.toBe("cleaned");
  expect(
    await retry(() => f.activities().cleanupSubtitleReplacement(input)),
  ).toEqual({ state: "cleaned" });
  expect(await readFile(f.filename, "utf8")).toBe(f.newText);
}, 20_000);
