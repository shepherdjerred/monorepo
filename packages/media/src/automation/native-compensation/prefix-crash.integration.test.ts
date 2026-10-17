import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { NativeCompensationScopeSchema } from "#shared/native-recovery/compensation.ts";
import { nativeCompensationFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
for (const stopAt of ["sidecar_link", "video"] as const)
  describe(`actual publication SIGKILL: ${stopAt}`, () => {
    let fixture:
      Awaited<ReturnType<typeof nativeCompensationFixture>> | undefined;
    beforeEach(async () => {
      fixture = await nativeCompensationFixture(
        harness.database(),
        harness.context().cipher,
        { stopAt, processKill: true },
      );
    });
    afterEach(async () => {
      if (fixture !== undefined)
        await rm(fixture.file.directory, { recursive: true, force: true });
    });
    test("cold review consumes only actual durable ACKs and restores exact video and sidecar", async () => {
      const f = fixture;
      if (f === undefined)
        throw new Error("Actual publication crash fixture missing");
      const db = harness.database();
      await f.prepare();
      const input = await f.apply();
      await f.observe(input);
      expect(
        await f.activities.compensateNativePublicationFiles(input),
      ).toEqual({ status: "compensated", reason: null });
      expect(
        await readFile(workerFilePath(f.file.context, f.canonicalPath), "utf8"),
      ).toBe(f.published.content);
      expect(
        await readFile(
          workerFilePath(f.file.context, z.string().parse(f.subtitle.path)),
          "utf8",
        ),
      ).toBe("1\n00:00:00,000 --> 00:00:01,000\nSynthetic subtitle\n");
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
      const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: f.input.planId },
      });
      const scope = NativeCompensationScopeSchema.parse(plan.scope);
      expect(scope.intent.entries).toHaveLength(1);
      expect(
        await db.acquisitionReservation.count({
          where: { attemptId: f.interrupted.attempt.id },
        }),
      ).toBe(0);
    });
  });
