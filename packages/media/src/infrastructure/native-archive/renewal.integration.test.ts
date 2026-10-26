import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import {
  archivePublicationTransitionFixture,
  releaseTransitionHousehold,
  type ArchiveDiagnosticStage,
} from "./publication-transition.test-support.ts";
import {
  approveArchiveRenewal,
  cleanRenewedArchive,
  prepareArchiveRenewal,
  type ArchiveTransitionFixture,
} from "./renewal.test-support.ts";
import { restoreNativeFixtureAgain } from "#automation/native-compensation/native-grant-fixture.ts";
import { traceArchiveReadBudget } from "./tests/read-budget-trace.test-support.ts";

const harness = automationTestHarness();
traceArchiveReadBudget("archive-renewal-read-diagnostic");
let stages: ArchiveDiagnosticStage[] = [];
function traceStage(stage: ArchiveDiagnosticStage) {
  stages.push(stage);
}
beforeEach((context) => {
  const current: ArchiveDiagnosticStage[] = [];
  stages = current;
  context.onTestFinished(() => {
    if (context.task.result?.state === "fail")
      console.warn(
        "archive-renewal-stage-diagnostic",
        JSON.stringify({ stages: current }),
      );
  });
});
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

describe.each([false, true])(
  "renewed full closure with reverse cleanup order %s",
  (reverse) => {
    let fixture: ArchiveTransitionFixture | undefined;
    beforeEach(async () => {
      fixture = await archivePublicationTransitionFixture(
        harness.database(),
        harness.context().cipher,
        harness.context(),
        { stopOldCleanup: "allocated", traceStage },
      );
      directories.push(fixture.file.directory);
    });
    test("allocated no-effect authority is terminally superseded and both dependencies clean in the selected order", async () => {
      if (fixture === undefined)
        throw new Error("Actual transition setup missing");
      const f = fixture;
      const db = harness.database();
      const ids = f.oldCleanups.map((row) => row.id);
      expect(ids).toHaveLength(2);
      const prepared = await prepareArchiveRenewal(db, f, ids);
      const id = await approveArchiveRenewal(db, f, prepared);
      const old = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.oldContinuation.id },
      });
      expect(old.state).toBe("superseded");
      expect(old.executionEvidence).toEqual(
        f.oldContinuation.executionEvidence,
      );
      expect(old.completion).toBeNull();
      const serving = await db.libraryAsset.findUniqueOrThrow({
        where: { id: f.entry.assetId },
      });
      for (const cleanupId of reverse ? ids.toReversed() : ids) {
        const result = await cleanRenewedArchive(db, f, id, cleanupId);
        expect(result.result).toEqual({ status: "cleaned" });
        expect(result.replay).toEqual(result.result);
      }
      expect(
        await db.libraryAsset.findUniqueOrThrow({ where: { id: serving.id } }),
      ).toEqual(serving);
      expect(
        await db.nativeRecoveryReceipt.findUniqueOrThrow({
          where: { id: f.oldReceipt.id },
        }),
      ).toEqual(f.oldReceipt);
      expect(
        await db.upgradeCleanup.findMany({
          where: { id: { in: ids } },
          orderBy: { id: "asc" },
        }),
      ).toEqual(f.oldCleanups);
    });
  },
);

describe.each(["prepared", "complete"] as const)(
  "old purge has actual %s journal",
  (phase) => {
    let fixture: ArchiveTransitionFixture | undefined;
    beforeEach(async () => {
      fixture = await archivePublicationTransitionFixture(
        harness.database(),
        harness.context().cipher,
        harness.context(),
        { stopOldCleanup: phase, traceStage },
      );
      directories.push(fixture.file.directory);
    });
    test("fresh C→D review cannot supersede uncertain old purge effects", async () => {
      if (fixture === undefined)
        throw new Error("Actual transition setup missing");
      const db = harness.database();
      const f = fixture;
      await expect(
        prepareArchiveRenewal(db, f, [f.first.id]),
      ).rejects.toThrow();
      const old = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.oldContinuation.id },
      });
      expect(old.supersession).toBeNull();
      expect(old.executionEvidence).toEqual(
        f.oldContinuation.executionEvidence,
      );
      expect(old.completion).toBeNull();
      expect(
        await db.nativeRecoveryReceipt.findUniqueOrThrow({
          where: { id: f.oldReceipt.id },
        }),
      ).toEqual(f.oldReceipt);
    });
  },
);

describe("fresh second restore after adjacent ordinary publication", () => {
  let fixture: ArchiveTransitionFixture | undefined;
  beforeEach(async () => {
    fixture = await archivePublicationTransitionFixture(
      harness.database(),
      harness.context().cipher,
      harness.context(),
      { traceStage },
    );
    directories.push(fixture.file.directory);
  });
  test("new epoch reviews the entire original chain and cleans only fresh authorized archives", async () => {
    if (fixture === undefined)
      throw new Error("Actual transition setup missing");
    const db = harness.database();
    const original = fixture;
    const restored = await restoreNativeFixtureAgain(db, original);
    const f = {
      ...original,
      runtime: restored.runtime,
      restore: restored.restore,
    };
    const prepared = await prepareArchiveRenewal(
      db,
      f,
      f.oldCleanups.map((row) => row.id),
    );
    const id = await approveArchiveRenewal(db, f, prepared);
    await releaseTransitionHousehold(db, f);
    for (const cleanup of f.oldCleanups) {
      const cleaned = await cleanRenewedArchive(db, f, id, cleanup.id);
      expect(cleaned.result).toEqual({ status: "cleaned" });
    }
    expect(
      await db.nativeRecoveryReceipt.findUniqueOrThrow({
        where: { id: f.oldReceipt.id },
      }),
    ).toEqual(f.oldReceipt);
    expect(
      await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.oldContinuation.id },
      }),
    ).toEqual(f.oldContinuation);
  });
  test("a still-running old coordinator cannot be replaced by owner review", async () => {
    if (fixture === undefined)
      throw new Error("Actual transition setup missing");
    const f = fixture;
    f.observerContext.describeWorkflow = () =>
      Promise.resolve({ status: "RUNNING", runId: "still-running" });
    await expect(
      prepareArchiveRenewal(harness.database(), f, [f.first.id]),
    ).rejects.toThrow();
    const continuation = await harness
      .database()
      .nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.oldContinuation.id },
      });
    expect(continuation.supersession).toBeNull();
  });
  test("a different closed coordinator run cannot consume the reviewed approval", async () => {
    if (fixture === undefined)
      throw new Error("Actual transition setup missing");
    const db = harness.database();
    const f = fixture;
    const prepared = await prepareArchiveRenewal(db, f, [f.first.id]);
    f.observerContext.describeWorkflow = () =>
      Promise.resolve({ status: "FAILED", runId: "different-terminal-run" });
    await expect(approveArchiveRenewal(db, f, prepared)).rejects.toThrow();
    const continuation =
      await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.oldContinuation.id },
      });
    expect(continuation.supersession).toBeNull();
    expect(
      await db.nativeRecoveryReceipt.count({
        where: { planId: prepared.input.planId },
      }),
    ).toBe(0);
  });
});
