import { MockActivityEnvironment } from "@temporalio/testing";
import { expect, vi } from "vitest";
import { z } from "zod";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import { seriesPackRoleResult } from "./result.ts";
import type { createPerEpisodeNativeRecoveryFixtureV1 } from "@shepherdjerred/media/testing/per-episode-native-recovery";
import {
  createSeriesPackNativeCompensationFileAdapterV1,
  createSeriesPackNativeCompensationNetworkAdapterV1,
} from "#activities/media/series-pack/native-compensation.ts";

type Fixture = Awaited<
  ReturnType<typeof createPerEpisodeNativeRecoveryFixtureV1>
>;
type Evidence = Awaited<ReturnType<Fixture["evidence"]>>;

/** Observe the exact original run while awaiting its real native ACK. A real
 * blocked completion fails promptly instead of becoming a60s unresolved wait. */
export async function waitForNativeSeriesPackInterruptionV1(
  scenario: Fixture,
  input: {
    environment: TestWorkflowEnvironment;
    workflowId: string;
    caseDeadline: number;
  },
) {
  const observed = (async () => {
    try {
      const result = await seriesPackRoleResult(input);
      if (scenario.interruptionRequested()) return await scenario.interrupted;
      const actual = z
        .object({ status: z.string(), reason: z.string().optional() })
        .parse(result);
      throw new Error(
        `Actual original acquisition ended before its native ACK: ${JSON.stringify({ status: actual.status, reason: nativeFailureText(actual.reason) })}`,
      );
    } catch (error) {
      if (scenario.interruptionRequested()) return scenario.interrupted;
      throw error;
    }
  })();
  return Promise.race([scenario.interrupted, observed]);
}

export function assertNativeSeriesPackInitialCaptionsV1(before: Evidence) {
  expect(before.captions).toHaveLength(48);
  expect(before.captionFiles).toHaveLength(48);
  for (const row of before.captions) {
    expect(row).toMatchObject({
      state: "installed",
      storageKind: "sidecar",
      providerId: "migration",
      qualityStatus: "unverified",
      ownershipEpoch: 0,
      version: 0,
      videoVersion: 0,
    });
    expect(before.captionFiles.find((file) => file.id === row.id)?.sha256).toBe(
      row.checksum,
    );
  }
}

export function assertNativeSeriesPackRestoredCaptionsV1(
  before: Evidence,
  after: Evidence,
) {
  expect(after.captionFiles).toEqual(before.captionFiles);
  expect(after.captions).toEqual(
    before.captions.map((row) => ({
      ...row,
      version: row.version + 1,
      ownershipEpoch: 1,
      videoVersion: 1,
    })),
  );
  const completion = z
    .object({
      predecessorBindings: z.array(
        z.object({
          after: z.object({
            subtitles: z.array(
              z.object({
                id: z.uuid(),
                version: z.int(),
                ownershipEpoch: z.int(),
              }),
            ),
          }),
        }),
      ),
    })
    .parse(after.continuations[0]?.completion);
  const acknowledgements = completion.predecessorBindings.flatMap(
    (binding) => binding.after.subtitles,
  );
  expect(acknowledgements).toHaveLength(48);
  expect(acknowledgements.map((row) => row.id).toSorted()).toEqual(
    after.captions.map((row) => row.id).toSorted(),
  );
  expect(
    acknowledgements.every(
      (row) => row.version === 1 && row.ownershipEpoch === 1,
    ),
  ).toBe(true);
}

/** Actual SDK contexts call the real adapters. Spies observe the original
 * counter, including all SQL reserves; they do not replace its admission. */
export async function nativeSeriesPackPaidV1<T>(
  method: string,
  charges: { method: string; paid: number }[],
  work: () => Promise<T>,
) {
  const startedAt = performance.now();
  const { PublicationAuthorityReadBudget } =
    await import("@shepherdjerred/media/publication-authority-budget");
  const spy = vi.spyOn(PublicationAuthorityReadBudget.prototype, "consume");
  try {
    const result = await work();
    const total = spy.mock.calls.reduce((sum, [count]) => sum + count, 0);
    expect(new Set(spy.mock.contexts).size).toBe(1);
    expect(total).toBeLessThanOrEqual(100);
    return result;
  } finally {
    const charge = {
      method,
      paid: spy.mock.calls.reduce((sum, [count]) => sum + count, 0),
    };
    charges.push(charge);
    await Bun.write(
      Bun.stdout,
      `Actual native pack phase measured: ${JSON.stringify({ ...charge, elapsedMs: Math.round(performance.now() - startedAt) })}\n`,
    );
    spy.mockRestore();
  }
}

export function nativeSeriesPackNetworkAdapterV1(scenario: Fixture) {
  return createSeriesPackNativeCompensationNetworkAdapterV1(() =>
    Promise.resolve({
      seriesPackNativeCompensation: tracedNativeNetwork(scenario),
    }),
  );
}

export function nativeSeriesPackFileAdapterV1(scenario: Fixture) {
  return createSeriesPackNativeCompensationFileAdapterV1(() =>
    Promise.resolve({
      seriesPackNativeCompensation: tracedNativeFiles(scenario),
    }),
  );
}

export async function runNativeSeriesPackRecoveryV1(
  scenario: Fixture,
  interrupted: Parameters<Fixture["restoreAndPrepare"]>[0],
  charges: { method: string; paid: number }[],
  execute?: (
    effect: Awaited<ReturnType<Fixture["effectInput"]>>,
  ) => Promise<Awaited<ReturnType<Fixture["effectInput"]>>>,
) {
  const paid = <T>(method: string, work: () => Promise<T>) =>
    nativeSeriesPackPaidV1(method, charges, work);
  const network = nativeSeriesPackNetworkAdapterV1(scenario);
  const files = nativeSeriesPackFileAdapterV1(scenario);
  const prepared = await paid("owner_prepare", () =>
    scenario.restoreAndPrepare(interrupted),
  );
  await paid("observe_review", () =>
    nativeRecoverySdk(prepared.operationId, "observe-review").run(
      network.observeSeriesPackNativeCompensationV1,
      prepared,
    ),
  );
  await paid("prepare_review", () =>
    nativeRecoverySdk(prepared.operationId, "prepare-review").run(
      files.prepareSeriesPackNativeCompensationV1,
      prepared,
    ),
  );
  const approved = await paid("owner_apply", () =>
    scenario.approve(prepared.planId),
  );
  await paid("observe_apply", () =>
    nativeRecoverySdk(approved.operationId, "observe-apply").run(
      network.observeSeriesPackNativeCompensationV1,
      { planId: approved.planId, operationId: approved.operationId },
    ),
  );
  await paid("apply_review", () =>
    nativeRecoverySdk(approved.operationId, "apply-review").run(
      files.applySeriesPackNativeCompensationV1,
      approved,
    ),
  );
  const effect = await scenario.effectInput(prepared.planId);
  if (execute !== undefined) return execute(effect);
  expect(
    await paid("observe_execution", () =>
      nativeRecoverySdk(effect.operationId, "observe-execution").run(
        network.observeSeriesPackNativeCompensationExecutionV1,
        effect,
      ),
    ),
  ).toEqual({ status: "ready", reason: null });
  expect(
    await paid("physical_compensation", () =>
      nativeRecoverySdk(effect.operationId, "physical-compensation").run(
        files.compensateSeriesPackNativePublicationV1,
        effect,
      ),
    ),
  ).toEqual({ status: "compensated", reason: null });
  return effect;
}

async function traceNativeFailure<T>(
  method: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const parsed = z
      .object({
        name: z.string().optional(),
        message: z.string().optional(),
        stack: z.string().optional(),
        code: z.string().optional(),
        meta: z
          .object({
            code: z.string().optional(),
            message: z.string().optional(),
          })
          .optional(),
      })
      .safeParse(error);
    const evidence = parsed.success
      ? {
          name: parsed.data.name,
          code: parsed.data.code,
          message: nativeFailureText(parsed.data.message),
          metaCode: parsed.data.meta?.code,
          metaMessage: nativeFailureText(parsed.data.meta?.message),
          frames: nativeFailureText(parsed.data.stack)?.split("\n").slice(0, 9),
        }
      : { name: "UnknownNativeFailure" };
    await Bun.write(
      Bun.stdout,
      `Actual native pack original failure: ${JSON.stringify({ method, ...evidence })}\n`,
    );
    throw error;
  }
}

function nativeFailureText(value: string | undefined) {
  return value
    ?.replaceAll(/(?:file:\/\/)?\/[^\n()]*?(?=\/packages\/)/gu, "")
    .replaceAll(/https?:\/\/[^\s"'()]+/gu, "<url>")
    .replaceAll(
      /\/(?:private|tmp|Users|Volumes|home|data|downloads)\/[^\s"'()]+/gu,
      "<private-path>",
    )
    .slice(0, 1800);
}

function tracedNativeNetwork(scenario: Fixture): Fixture["nativeNetwork"] {
  const actual = scenario.nativeNetwork;
  return {
    ...actual,
    observeSeriesPackNativeCompensationV1: (...args) =>
      traceNativeFailure("observe_review", () =>
        actual.observeSeriesPackNativeCompensationV1(...args),
      ),
    observeSeriesPackNativeCompensationExecutionV1: (...args) =>
      traceNativeFailure("observe_execution", () =>
        actual.observeSeriesPackNativeCompensationExecutionV1(...args),
      ),
    seriesPackNativeCompensationStateV1: (...args) =>
      traceNativeFailure("state", () =>
        actual.seriesPackNativeCompensationStateV1(...args),
      ),
    publishSeriesPackNativeCompensationV1: (...args) =>
      traceNativeFailure("publish", () =>
        actual.publishSeriesPackNativeCompensationV1(...args),
      ),
  };
}

function tracedNativeFiles(scenario: Fixture): Fixture["nativeFiles"] {
  const actual = scenario.nativeFiles;
  return {
    ...actual,
    prepareSeriesPackNativeCompensationV1: (...args) =>
      traceNativeFailure("prepare", () =>
        actual.prepareSeriesPackNativeCompensationV1(...args),
      ),
    applySeriesPackNativeCompensationV1: (...args) =>
      traceNativeFailure("apply", () =>
        actual.applySeriesPackNativeCompensationV1(...args),
      ),
    compensateSeriesPackNativePublicationV1: (...args) =>
      traceNativeFailure("physical", () =>
        actual.compensateSeriesPackNativePublicationV1(...args),
      ),
  };
}

export function nativeRecoverySdk(operationId: string, activityId: string) {
  const actual = new MockActivityEnvironment({
    workflowExecution: {
      workflowId: `media-operation-${operationId}`,
      runId: crypto.randomUUID(),
    },
    activityId,
    scheduledTimestampMs: Date.now(),
    currentAttemptScheduledTimestampMs: Date.now(),
    startToCloseTimeoutMs: 120_000,
    scheduleToCloseTimeoutMs: 300_000,
    heartbeatTimeoutMs: 60_000,
  });
  return {
    run: <Args extends unknown[], Result>(
      activity: (...args: Args) => Promise<Result>,
      ...args: Args
    ) => actual.run<Args, Result, typeof activity>(activity, ...args),
  };
}
