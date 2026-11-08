import { afterAll, beforeAll, expect, test } from "vitest";
import { createPerEpisodeNativeRecoveryFixtureV1 } from "@shepherdjerred/media/testing/per-episode-native-recovery";
import { createNativeRecoveryPrerequisiteV1 } from "./native-recovery-prerequisite.ts";
import {
  runNativeSeriesPackRecoveryV1,
  assertNativeSeriesPackInitialCaptionsV1,
  assertNativeSeriesPackRestoredCaptionsV1,
} from "./native-recovery-phases.ts";
import {
  reconcileNativeSeriesPackHouseholdV1,
  publishNativeSeriesPackV1,
} from "./native-recovery-serving.ts";
import { assertNativeSeriesPackWatchV1 } from "./native-recovery-watch.ts";
import {
  createNativeSeriesPackSourceRoleV1,
  assertNativeSeriesPackSourceHoldV1,
} from "./native-recovery-source.ts";
import { retryNativeSeriesPackCoordinatorV1 } from "./native-recovery-retry.ts";
import { createNativeSeriesPackRecoveryRoleV1 } from "./native-recovery-role.ts";
import { z } from "zod";

type Fixture = Awaited<
  ReturnType<typeof createPerEpisodeNativeRecoveryFixtureV1>
>;
let fixture: Fixture | undefined;
let fixtureClose: (() => Promise<void>) | undefined;
let prerequisite:
  ReturnType<typeof createNativeRecoveryPrerequisiteV1> | undefined;
let baseline: Awaited<ReturnType<Fixture["evidence"]>> | undefined;
let interrupted: Awaited<Fixture["interrupted"]> | undefined;
let recovered:
  Awaited<ReturnType<typeof runNativeSeriesPackRecoveryV1>> | undefined;
let sourceRole:
  ReturnType<typeof createNativeSeriesPackSourceRoleV1> | undefined;
const recoveryRoles: ReturnType<typeof createNativeSeriesPackRecoveryRoleV1>[] =
  [];
const totalStartedAt = performance.now();

// Register ownership before either setup hook begins. Failed/expired hooks still
// close exact created Node/Temporal/PG resources; real SDK/storage clocks persist.
afterAll(async () => {
  try {
    for (const role of recoveryRoles.toReversed()) await role.close();
    await sourceRole?.close();
  } finally {
    try {
      await prerequisite?.close();
    } finally {
      await fixtureClose?.();
    }
  }
}, 60_000);

beforeAll(async () => {
  const startedAt = performance.now();
  fixture = await createPerEpisodeNativeRecoveryFixtureV1((close) => {
    fixtureClose = close;
  });
  baseline = await fixture.evidence();
  assertNativeSeriesPackInitialCaptionsV1(baseline);
  await Bun.write(
    Bun.stdout,
    `Actual native pack prerequisite measured: ${JSON.stringify({ phase: "initial_library_bootstrap", elapsedMs: Math.round(performance.now() - startedAt) })}\n`,
  );
}, 60_000);

beforeAll(async () => {
  if (fixture === undefined)
    throw new Error("Genuine initial library fixture missing");
  const startedAt = performance.now();
  prerequisite = createNativeRecoveryPrerequisiteV1(fixture);
  try {
    interrupted = await prerequisite.run();
  } catch (error) {
    const evidence = await prerequisite.evidence();
    throw new Error(
      `Actual native acquisition prerequisite failed: ${JSON.stringify(evidence)}`,
      { cause: error },
    );
  }
  await Bun.write(
    Bun.stdout,
    `Actual native pack prerequisite measured: ${JSON.stringify({ phase: "original_outbox_acquisition_to_real_interruption", elapsedMs: Math.round(performance.now() - startedAt) })}\n`,
  );
}, 60_000);

/** Independent real prerequisites retain the SAME persistedDB, bytes and WAL.
 * This60s case contains the complete native owner-review/physical effect with
 * actual SDK contexts; SQL30/RPC20/original100 and real storage clocks remain.
 * It does not yet claim a native Workflow-role or household serving release. */
test("an actual interrupted twenty-four-file Node acquisition resumes a terminal physical recovery coordinator through the real owner API and new outbox run under each original100 allowance", async () => {
  const caseDeadline = Date.now() + 60_000;
  if (
    fixture === undefined ||
    baseline === undefined ||
    interrupted === undefined ||
    prerequisite === undefined
  )
    throw new Error("Actual native prerequisites did not complete");
  const scenario = fixture;
  const before = baseline;
  const charges: { method: string; paid: number }[] = [];
  const nativeStartedAt = performance.now();
  try {
    recovered = await runNativeSeriesPackRecoveryV1(
      scenario,
      interrupted,
      charges,
      async (effect) => {
        const environment = prerequisite?.workflowEnvironment();
        if (environment === undefined)
          throw new Error("Actual native recovery Temporal server missing");
        const next = await retryNativeSeriesPackCoordinatorV1(
          scenario,
          environment,
          { phase: "physical", effect, caseDeadline },
          charges,
        );
        const role = createNativeSeriesPackRecoveryRoleV1(
          scenario,
          environment,
          charges,
        );
        recoveryRoles.push(role);
        try {
          await role.run(next, "physical", caseDeadline);
          return next;
        } finally {
          await role.close();
        }
      },
    );
    const after = await scenario.evidence();
    assertNativeSeriesPackRestoredCaptionsV1(before, after);
    expect(after.transition?.outcome).toBeNull();
    expect(after.originalLiteral).not.toBeNull();
    expect(after.originalUntouched).toBe(true);
    expect(after.transition).not.toBeNull();
    expect(after.attempt).not.toBeNull();
    expect(after.hashes).toEqual(before.hashes);
    expect(after.coverage).toHaveLength(24);
    expect(new Set(after.coverage.map((row) => row.assetId))).toEqual(
      new Set(scenario.originalAssetIds),
    );
    expect(
      after.coverage.every(
        (row) =>
          row.asset.version === 1 &&
          row.asset.ownershipEpoch === 1 &&
          row.asset.state === "published",
      ),
    ).toBe(true);
    expect(after.continuations).toHaveLength(1);
    expect(after.continuations[0]).toMatchObject({
      state: "compensated",
      fenceRelease: null,
      verifiedPublication: null,
    });
    expect(after.sourceAdds).toBe(1);
    expect(after.receipts).toEqual(before.receipts);
    expect(after.holds).toHaveLength(24);
    expect(after.holds.every((row) => row.releasedAt === null)).toBe(true);
    await Bun.write(
      Bun.stdout,
      `Actual native pack phase authority rows: ${JSON.stringify(charges)}\n`,
    );
    await Bun.write(
      Bun.stdout,
      `Actual native pack journey measured: ${JSON.stringify({ nativeEffectMs: Math.round(performance.now() - nativeStartedAt), totalEndToEndMs: Math.round(performance.now() - totalStartedAt) })}\n`,
    );
  } catch (error) {
    const evidence = await prerequisite.evidence();
    throw new Error(
      `Actual prior-epoch pack native path failed: ${JSON.stringify({ charges, evidence })}`,
      { cause: error },
    );
  }
}, 60_000);

test("actual household review and a terminal publication coordinator retry verify Plex and release only the recovered twenty-four-file native fence under original caller allowances", async () => {
  const caseDeadline = Date.now() + 60_000;
  if (
    fixture === undefined ||
    recovered === undefined ||
    prerequisite === undefined
  )
    throw new Error(
      "The genuine native physical prerequisite did not complete",
    );
  const charges: { method: string; paid: number }[] = [];
  try {
    await reconcileNativeSeriesPackHouseholdV1(fixture, charges);
    const row =
      await fixture.db.nativePublicationCompensationContinuation.findUniqueOrThrow(
        {
          where: { id: recovered.continuationId },
        },
      );
    const environment = prerequisite.workflowEnvironment();
    const next = await retryNativeSeriesPackCoordinatorV1(
      fixture,
      environment,
      {
        phase: "publication",
        caseDeadline,
        effect: {
          schemaVersion: 1,
          continuationId: row.id,
          operationId: z.uuid().parse(row.publicationCoordinatorOperationId),
          recoveryEpoch: row.recoveryEpoch,
        },
      },
      charges,
    );
    const role = createNativeSeriesPackRecoveryRoleV1(
      fixture,
      environment,
      charges,
    );
    recoveryRoles.push(role);
    try {
      await role.run(next, "publication", caseDeadline);
    } finally {
      await role.close();
    }
    await publishNativeSeriesPackV1(fixture, recovered.continuationId, charges);
    const after = await fixture.evidence();
    expect(after.originalUntouched).toBe(true);
    expect(after.holds.every((hold) => hold.releasedAt !== null)).toBe(true);
    expect(after.continuations).toHaveLength(1);
    expect(after.continuations[0]?.verifiedPublication).not.toBeNull();
    expect(after.continuations[0]?.fenceRelease).not.toBeNull();
  } catch (error) {
    throw new Error(
      `Actual native household/serving failed: ${JSON.stringify({ charges })}`,
      { cause: error },
    );
  }
}, 60_000);

test("the actual native TV watch cursor observes two complete requester targets and queues current retention within each original100 Activity", async () => {
  if (fixture === undefined || recovered === undefined)
    throw new Error(
      "The genuine native recovery prerequisite did not complete",
    );
  const charges: { method: string; paid: number }[] = [];
  try {
    await assertNativeSeriesPackWatchV1(fixture, charges);
  } catch (error) {
    throw new Error(
      `Actual native TV watch failed: ${JSON.stringify({ charges })}`,
      {
        cause: error,
      },
    );
  }
}, 60_000);

test("the actual Tokyo source outbox dispatches a credentialless Node seeding Workflow after real ratio obligations and removes only the original owned download", async () => {
  const caseDeadline = Date.now() + 60_000;
  if (
    fixture === undefined ||
    recovered === undefined ||
    prerequisite === undefined ||
    baseline === undefined
  )
    throw new Error("The genuine native serving prerequisite did not complete");
  const charges: { method: string; paid: number }[] = [];
  const input = await fixture.nativeSourceInput(recovered.continuationId);
  sourceRole = createNativeSeriesPackSourceRoleV1(
    fixture,
    prerequisite.workflowEnvironment(),
    charges,
  );
  try {
    await assertNativeSeriesPackSourceHoldV1(fixture, input, charges);
    fixture.sourceRatio(1);
    await sourceRole.run(input, caseDeadline);
    expect(fixture.sourceRemovals()).toBe(1);
    const torrent = await fixture.db.torrent.findUniqueOrThrow({
      where: { id: input.torrentId },
    });
    expect(torrent).toMatchObject({
      state: "removed",
      owned: true,
      ownershipEpoch: 0,
    });
    const operation = await fixture.db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
      include: { outbox: true },
    });
    expect(operation.status).toBe("completed");
    expect(operation.outbox?.dispatchedAt).not.toBeNull();
    const after = await fixture.evidence();
    expect(after.originalUntouched).toBe(true);
    expect(after.hashes).toEqual(baseline.hashes);
    assertNativeSeriesPackRestoredCaptionsV1(baseline, after);
  } catch (error) {
    throw new Error(
      `Actual native source role failed: ${JSON.stringify({ charges })}`,
      { cause: error },
    );
  } finally {
    await sourceRole.close();
  }
}, 60_000);
