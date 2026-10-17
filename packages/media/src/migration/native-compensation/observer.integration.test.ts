import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "#automation/native-compensation/test-fixture.ts";
import {
  NativeCompensationScopeSchema,
  NativeCompensationNetworkEvidenceSchema,
} from "#shared/native-recovery/compensation.ts";
import { observeNativeCompensation } from "./producer.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let directory: string | undefined;
beforeAll(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
    { stopAt: "sidecar_link" },
  );
  directory = fixture.file.directory;
}, 60_000);
afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

test("fresh compensation observation binds absolute canonical paths and every retained participant", async () => {
  const db = harness.database();
  await observeNativeCompensation(
    fixture.observerContext,
    fixture.input,
    testCompensationExecution(),
  );
  const stored = await db.nativeRecoveryObservation.findFirstOrThrow({
    where: { planId: fixture.input.planId, kind: "network" },
    orderBy: { observedAt: "desc" },
  });
  const evidence = NativeCompensationNetworkEvidenceSchema.parse(
    stored.evidence,
  );
  expect(evidence.plex.canonicalPaths[0]?.canonicalPath).toBe(
    fixture.canonicalPath,
  );
  expect(evidence.plex.canonicalPaths[0]?.items).toHaveLength(1);
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: fixture.input.planId },
  });
  const scope = NativeCompensationScopeSchema.parse(plan.scope);
  expect(scope.requiredAbsences.length).toBeGreaterThan(0);
  expect(
    new Set(evidence.plex.retainedAbsence.flatMap((item) => item.paths)),
  ).toEqual(new Set(scope.requiredAbsences.map((item) => item.canonicalPath)));
});

test("actual canonical-path playback blocks compensation even with an unrelated session rating key", async () => {
  const before = await harness.database().nativeRecoveryObservation.count({
    where: { planId: fixture.input.planId },
  });
  const context = {
    ...fixture.observerContext,
    plex: {
      ...fixture.observerContext.plex,
      activeSessions: () =>
        Promise.resolve([
          {
            ratingKey: "unrelated-session",
            title: "Actual canonical path session",
            type: "movie",
            Media: [{ Part: [{ id: 1, file: fixture.canonicalPath }] }],
          },
        ]),
    },
  };
  await expect(
    observeNativeCompensation(
      context,
      fixture.input,
      testCompensationExecution(),
    ),
  ).rejects.toMatchObject({ code: "compensation_playback_active_or_unknown" });
  expect(
    await harness.database().nativeRecoveryObservation.count({
      where: { planId: fixture.input.planId },
    }),
  ).toBe(before);
});

test("a retained control file indexed in an unconfigured video section blocks compensation", async () => {
  const db = harness.database();
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: fixture.input.planId },
  });
  const retained = NativeCompensationScopeSchema.parse(plan.scope)
    .requiredAbsences[0];
  if (retained === undefined) throw new Error("Actual retained path missing");
  const context = {
    ...fixture.observerContext,
    plex: {
      ...fixture.observerContext.plex,
      sections: async () => [
        ...(await fixture.observerContext.plex.sections()),
        { key: "9", type: "movie", title: "Other video library" },
      ],
      libraryPage: (
        input: Parameters<typeof fixture.observerContext.plex.libraryPage>[0],
      ) =>
        input.sectionId === "9"
          ? Promise.resolve({
              total: 1,
              items: [
                {
                  ratingKey: "retained-in-other-library",
                  title: "Indexed retained artifact",
                  type: "movie",
                  Media: [{ Part: [{ id: 1, file: retained.canonicalPath }] }],
                },
              ],
            })
          : fixture.observerContext.plex.libraryPage(input),
    },
  };
  const before = await db.nativeRecoveryObservation.count({
    where: { planId: plan.id },
  });
  await expect(
    observeNativeCompensation(
      context,
      fixture.input,
      testCompensationExecution(),
    ),
  ).rejects.toMatchObject({ code: "native_archive_plex_archive_indexed" });
  expect(
    await db.nativeRecoveryObservation.count({ where: { planId: plan.id } }),
  ).toBe(before);
});

test("a video section appearing after complete inventory prevents a fresh observation", async () => {
  let reads = 0;
  const context = {
    ...fixture.observerContext,
    plex: {
      ...fixture.observerContext.plex,
      sections: async () => {
        const sections = await fixture.observerContext.plex.sections();
        reads += 1;
        return reads === 1
          ? sections
          : [
              ...sections,
              { key: "9", type: "show", title: "Late video library" },
            ];
      },
    },
  };
  await expect(
    observeNativeCompensation(
      context,
      fixture.input,
      testCompensationExecution(),
    ),
  ).rejects.toMatchObject({ code: "compensation_plex_sections_changed" });
  expect(reads).toBe(2);
});

test("expiration during the final playback read cannot persist otherwise valid network evidence", async () => {
  const db = harness.database();
  const before = await db.nativeRecoveryObservation.count({
    where: { planId: fixture.input.planId },
  });
  const execution = testCompensationExecution();
  const failure = new Error(
    "Actual invocation expired during the external read",
  );
  let expired = false;
  const context = {
    ...fixture.observerContext,
    plex: {
      ...fixture.observerContext.plex,
      activeSessions: () => {
        expired = true;
        return Promise.resolve([]);
      },
    },
  };
  await expect(
    observeNativeCompensation(context, fixture.input, {
      ...execution,
      assertActive: () => {
        execution.assertActive();
        if (expired) throw failure;
      },
    }),
  ).rejects.toBe(failure);
  expect(
    await db.nativeRecoveryObservation.count({
      where: { planId: fixture.input.planId },
    }),
  ).toBe(before);
});
