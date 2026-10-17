import { afterEach, beforeEach, expect, test } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { nativeCompensationFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>> | undefined;
let activity: NativeCompensationActivityInput | undefined;
beforeEach(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  await fixture.prepare();
  activity = await fixture.apply();
  await fixture.observe(activity);
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test.each([
  "publication-effect-ack:rollback_rejected_link",
  "native-compensation-before-commit",
])(
  "actual SIGKILL at %s cold-reconciles exact durable identities without changing the interrupted publication",
  async (phase) => {
    const f = fixture;
    const input = activity;
    if (f === undefined || input === undefined)
      throw new Error("Prepared crash fixture missing");
    const db = harness.database();
    const ports = await db.$queryRaw<
      { port: number }[]
    >`SELECT inet_server_port() AS port`;
    const port = z.int().positive().parse(ports[0]?.port);
    const config = path.join(f.file.directory, "compensation-crash.json");
    await writeFile(
      config,
      JSON.stringify({
        databaseUrl: `postgres://media@127.0.0.1:${String(port)}/postgres`,
        roots: f.context.files.roots,
        workerPodUid: f.context.workerPodUid,
        input,
        phase,
      }),
    );
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("fixtures/crash.ts", import.meta.url)), config],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let diagnostics = "";
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    try {
      const [, signal] = await once(child, "exit");
      expect(signal, diagnostics).toBe("SIGKILL");
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
    const interrupted =
      await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: input.continuationId },
      });
    expect(interrupted.executionEvidence).not.toBeNull();
    expect(interrupted.completion).toBeNull();
    await f.observe(input);
    expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
      status: "compensated",
      reason: null,
    });
    const completed =
      await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: input.continuationId },
      });
    expect(completed.executionEvidence).toEqual(interrupted.executionEvidence);
    expect(completed.completion).not.toBeNull();
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.interrupted.attempt.id },
      }),
    ).toEqual(f.beforeRestore.attempt);
    expect(
      await db.mediaPublicationTransition.findUniqueOrThrow({
        where: { id: f.transition.id },
      }),
    ).toEqual(f.beforeRestore.transition);
    expect(
      await readFile(workerFilePath(f.file.context, f.canonicalPath), "utf8"),
    ).toBe(f.published.content);
    expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
      status: "compensated",
      reason: null,
    });
    expect(
      await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: input.continuationId },
      }),
    ).toEqual(completed);
  },
);
