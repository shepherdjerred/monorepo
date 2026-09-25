import { describe, expect, test } from "vitest";
import type { Client, WorkflowStartOptions } from "@temporalio/client";
import { ApplicationFailure } from "@temporalio/common";
import { Worker } from "@temporalio/worker";
import { z } from "zod";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type {
  ScoutMatchObservationV2Input,
  ScoutMatchPipelineStateV2Result,
  ScoutMatchReceiptsV2Input,
} from "#src/activity-contracts-v2.ts";
import { scoutClientMatchDispatchV2WorkflowId } from "#src/identifiers.ts";
import { dispatchScoutClientMatchesV2Signal } from "#src/signals.ts";
import {
  scoutClientMatchDispatchV2InputCodec,
  scoutPostMatchDiscoveryV2InputCodec,
  scoutPostMatchDiscoveryV2ResultCodec,
  type ScoutClientMatchDispatchItemV2,
} from "#src/workflow-contracts-v2.ts";
import {
  scoutClientMatchDispatchV2Workflow,
  scoutPostMatchDiscoveryV2Workflow,
} from "./index.ts";
import { SCOUT_V2_DISPATCH_RIOT_BYPASSES_WATERMARK_PATCH } from "./client-match-dispatch-v2.ts";
import {
  createScoutV2MatchStore,
  MATCH_ID,
  scoutV2MatchActivityStubs,
  type ScoutV2MatchStore,
} from "./match-v2.test-fixtures.ts";
import { useScoutV2WorkflowHarness } from "./workflow-harness.test-fixtures.ts";

const harness = useScoutV2WorkflowHarness();
const stage = "dev" as const;
const SECOND_MATCH_ID = RiotMatchIdSchema.parse("NA1_9002");
const SOURCE_PUUID = LeaguePuuidSchema.parse("s".repeat(78));
const READY_AT = IsoInstantSchema.parse("2026-09-13T08:00:00.000Z");
const POLL_OWNER = IsoInstantSchema.parse("2026-09-13T07:59:00.000Z");

type RoutedActivityHooks = {
  readonly beforeCommit?: (
    input: ScoutMatchObservationV2Input,
  ) => void | Promise<void>;
  readonly onFanOut?: (riotMatchId: string) => void;
  readonly onRead?: (riotMatchId: string) => void | Promise<void>;
  readonly legacyCompleted?: (
    riotMatchId: string,
  ) => boolean | Promise<boolean>;
  readonly readResult?: (
    riotMatchId: string,
  ) => ScoutMatchPipelineStateV2Result | undefined;
  readonly onTerminalReceipt?: (riotMatchId: string) => void | Promise<void>;
};

function routedMatchActivities(
  firstStore: ScoutV2MatchStore,
  secondStore: ScoutV2MatchStore,
  hooks: RoutedActivityHooks = {},
) {
  const first = scoutV2MatchActivityStubs(firstStore);
  const second = scoutV2MatchActivityStubs(secondStore);
  const activitiesFor = (riotMatchId: string) =>
    riotMatchId === MATCH_ID ? first : second;
  return {
    readMatchPipelineStateV2: async (input: { riotMatchId: string }) => {
      await hooks.onRead?.(input.riotMatchId);
      return (
        hooks.readResult?.(input.riotMatchId) ??
        activitiesFor(input.riotMatchId).readMatchPipelineStateV2()
      );
    },
    readLegacyMatchCompletionV2: async (input: { riotMatchId: string }) => ({
      completed: (await hooks.legacyCompleted?.(input.riotMatchId)) ?? false,
    }),
    archiveMatchArtifactsV2: (input: { riotMatchId: string }) =>
      activitiesFor(input.riotMatchId).archiveMatchArtifactsV2(),
    commitMatchObservationV2: async (input: ScoutMatchObservationV2Input) => {
      await hooks.beforeCommit?.(input);
      return activitiesFor(input.riotMatchId).commitMatchObservationV2(input);
    },
    settleMatchMarketsV2: (input: { riotMatchId: string }) =>
      activitiesFor(input.riotMatchId).settleMatchMarketsV2(),
    applyMatchProgressionV2: (input: { riotMatchId: string }) =>
      activitiesFor(input.riotMatchId).applyMatchProgressionV2(),
    finalizeTournamentResultV2: (input: { riotMatchId: string }) =>
      activitiesFor(input.riotMatchId).finalizeTournamentResultV2(),
    recordMatchReceiptsV2: (input: ScoutMatchReceiptsV2Input) =>
      activitiesFor(input.riotMatchId).recordMatchReceiptsV2(input),
    recordClientMatchTerminalV2: async (input: { riotMatchId: string }) => {
      await hooks.onTerminalReceipt?.(input.riotMatchId);
      return { outcome: "applied" } as const;
    },
    mintPostmatchNotificationIntentsV2: (input: { riotMatchId: string }) =>
      activitiesFor(input.riotMatchId).mintPostmatchNotificationIntentsV2(),
    advanceMatchCursorV2: (input: { riotMatchId: string }) =>
      activitiesFor(input.riotMatchId).advanceMatchCursorV2(),
    planMatchFanOutV2: (input: { riotMatchId: string }) => {
      hooks.onFanOut?.(input.riotMatchId);
      return { notificationIntentKeys: [], lakeProjection: false };
    },
  };
}

function dispatchItem(
  riotMatchId: typeof MATCH_ID,
  gameEndTimestamp: number,
  readyAt = READY_AT,
): ScoutClientMatchDispatchItemV2 {
  return {
    riotMatchId,
    sourcePuuid: SOURCE_PUUID,
    deliveryMode: "live",
    gameEndTimestamp,
    readyAt,
    completionTargets: [],
  };
}

function terminalFailureActivities(
  log: string[],
  onSecondFanOut: () => void,
  onTerminalReceipt: NonNullable<RoutedActivityHooks["onTerminalReceipt"]>,
) {
  return routedMatchActivities(
    createScoutV2MatchStore(),
    createScoutV2MatchStore(),
    {
      beforeCommit: (input) => {
        log.push(`${input.riotMatchId}:commit`);
        if (input.riotMatchId === MATCH_ID) {
          throw ApplicationFailure.nonRetryable(
            "conflicting client evidence",
            "ScoutClientObservationConflict",
          );
        }
      },
      onFanOut: (riotMatchId) => {
        log.push(`${riotMatchId}:fan-out`);
        if (riotMatchId === SECOND_MATCH_ID) onSecondFanOut();
      },
      onTerminalReceipt,
    },
  );
}

async function startDispatcher(workflowId: string) {
  return await harness
    .client()
    .workflow.start(scoutClientMatchDispatchV2Workflow, {
      taskQueue: "scout-dev",
      workflowId,
      args: [
        scoutClientMatchDispatchV2InputCodec.serialize({
          stage,
          pending: [],
          lateArrivals: [],
          orderingWatermark: null,
        }),
      ],
    });
}

/**
 * Stop the never-returning dispatcher once a test has observed what it needs.
 *
 * The dispatcher only closes on its own by timing out: the time-skipping
 * server gives it the default ten-year execution timeout, and while a test
 * awaits a discovery's result time skipping is unlocked, so an idle
 * environment can jump straight to that deadline before the result returns.
 * Whether it does is a race, so the latest run is either still RUNNING or
 * already TIMED_OUT, and terminating a closed run throws
 * `WorkflowNotFoundError`. Time stays locked between these two calls, so the
 * status read here cannot go stale before the terminate. Any other closed
 * status is a real defect and fails the test.
 */
async function terminateDispatcher(workflowId: string, reason: string) {
  const handle = harness.client().workflow.getHandle(workflowId);
  const { status } = await handle.describe();
  if (status.name === "RUNNING") {
    await handle.terminate(reason);
    return;
  }
  expect(status.name).toBe("TIMED_OUT");
}

describe("the shared V2 match dispatcher", () => {
  test("processes signaled matches serially in completion order", async () => {
    const log: string[] = [];
    const completed = Promise.withResolvers<true>();
    await harness.startWorkers({
      ...routedMatchActivities(
        createScoutV2MatchStore(),
        createScoutV2MatchStore(),
        {
          onRead: (riotMatchId) => {
            log.push(`${riotMatchId}:read`);
          },
          onFanOut: (riotMatchId) => {
            log.push(`${riotMatchId}:fan-out`);
            if (riotMatchId === SECOND_MATCH_ID) completed.resolve(true);
          },
        },
      ),
    });
    const workflowId = "client-match-dispatch-serial";
    const handle = await startDispatcher(workflowId);

    await handle.signal(dispatchScoutClientMatchesV2Signal, [
      // Deliberately reversed: completion time, not signal order, wins.
      dispatchItem(SECOND_MATCH_ID, 2),
      dispatchItem(MATCH_ID, 1),
    ]);
    await completed.promise;
    await terminateDispatcher(
      workflowId,
      "test observed both serialized children",
    );

    expect(log).toEqual([
      `${MATCH_ID}:read`,
      `${MATCH_ID}:read`,
      `${MATCH_ID}:fan-out`,
      `${SECOND_MATCH_ID}:read`,
      `${SECOND_MATCH_ID}:read`,
      `${SECOND_MATCH_ID}:fan-out`,
    ]);
  }, 90_000);

  test("serializes Riot discovery behind an earlier client match", async () => {
    const firstCommit = Promise.withResolvers<true>();
    const releaseFirst = Promise.withResolvers<true>();
    const secondFanOut = Promise.withResolvers<true>();
    const discoveryCalled = Promise.withResolvers<true>();
    const log: string[] = [];
    await harness.startWorkers({
      ...routedMatchActivities(
        createScoutV2MatchStore(),
        createScoutV2MatchStore(),
        {
          beforeCommit: async (input) => {
            log.push(`${input.riotMatchId}:commit`);
            if (input.riotMatchId === MATCH_ID) {
              firstCommit.resolve(true);
              await releaseFirst.promise;
            }
          },
          onFanOut: (riotMatchId) => {
            log.push(`${riotMatchId}:fan-out`);
            if (riotMatchId === SECOND_MATCH_ID) secondFanOut.resolve(true);
          },
        },
      ),
      discoverPostMatchIdsV2: () => {
        discoveryCalled.resolve(true);
        return {
          outcome: "scanned",
          riotMatchIds: [SECOND_MATCH_ID],
          matches: [
            {
              riotMatchId: SECOND_MATCH_ID,
              sourcePuuid: SOURCE_PUUID,
              deliveryMode: "live",
              gameEndTimestamp: 2,
            },
          ],
          complete: true,
          pollOwner: POLL_OWNER,
        };
      },
      runPostMatchMaintenance: () => log.push("maintenance"),
    });
    const dispatcherId = scoutClientMatchDispatchV2WorkflowId(stage);
    const dispatcher = await startDispatcher(dispatcherId);
    await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
      dispatchItem(MATCH_ID, 1),
    ]);
    await firstCommit.promise;

    const discovery = harness
      .client()
      .workflow.execute(scoutPostMatchDiscoveryV2Workflow, {
        taskQueue: "scout-dev",
        workflowId: "riot-discovery-through-shared-dispatcher",
        args: [
          scoutPostMatchDiscoveryV2InputCodec.serialize({
            stage,
            trigger: "schedule",
          }),
        ],
      });
    await discoveryCalled.promise;
    const overtook = await Promise.race([
      secondFanOut.promise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    expect(overtook).toBe(false);

    releaseFirst.resolve(true);
    await expect(discovery).resolves.toEqual(
      scoutPostMatchDiscoveryV2ResultCodec.serialize({
        status: "completed",
        discovered: 1,
        childrenStarted: 1,
        complete: true,
      }),
    );
    expect(log.indexOf(`${MATCH_ID}:fan-out`)).toBeLessThan(
      log.indexOf(`${SECOND_MATCH_ID}:commit`),
    );
    expect(log.at(-1)).toBe("maintenance");
  }, 90_000);

  test("advances after a permanently failed match", async () => {
    const secondFanOut = Promise.withResolvers<true>();
    const log: string[] = [];
    await harness.startWorkers({
      ...terminalFailureActivities(
        log,
        () => secondFanOut.resolve(true),
        (riotMatchId) => {
          log.push(`${riotMatchId}:terminal-receipt`);
        },
      ),
    });
    const workflowId = "client-match-dispatch-terminal";
    const dispatcher = await startDispatcher(workflowId);

    await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
      dispatchItem(MATCH_ID, 1),
      dispatchItem(SECOND_MATCH_ID, 2),
    ]);
    await secondFanOut.promise;
    await terminateDispatcher(
      workflowId,
      "test observed progress past terminal failure",
    );

    expect(log.filter((entry) => entry === `${MATCH_ID}:commit`)).toHaveLength(
      1,
    );
    expect(log).toContain(`${MATCH_ID}:terminal-receipt`);
    expect(log.indexOf(`${MATCH_ID}:terminal-receipt`)).toBeLessThan(
      log.indexOf(`${SECOND_MATCH_ID}:fan-out`),
    );
    expect(log.indexOf(`${MATCH_ID}:commit`)).toBeLessThan(
      log.indexOf(`${SECOND_MATCH_ID}:fan-out`),
    );
  }, 90_000);
});

test("preserves the queue while a terminal marker cannot be recorded", async () => {
  const secondFanOut = Promise.withResolvers<true>();
  const log: string[] = [];
  let terminalAttempts = 0;
  await harness.startWorkers({
    ...terminalFailureActivities(
      log,
      () => secondFanOut.resolve(true),
      (riotMatchId) => {
        terminalAttempts += 1;
        log.push(
          `${riotMatchId}:terminal-receipt:${terminalAttempts.toString()}`,
        );
        if (terminalAttempts === 1) {
          throw ApplicationFailure.nonRetryable(
            "realtime database unavailable",
            "TerminalMarkerUnavailableForTest",
          );
        }
      },
    ),
  });
  const workflowId = "client-match-dispatch-terminal-marker-retry";
  const dispatcher = await startDispatcher(workflowId);

  await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
    dispatchItem(MATCH_ID, 1),
    dispatchItem(SECOND_MATCH_ID, 2),
  ]);
  await secondFanOut.promise;
  await terminateDispatcher(
    workflowId,
    "test observed progress after terminal marker recovery",
  );

  expect(terminalAttempts).toBe(2);
  expect(log.filter((entry) => entry === `${MATCH_ID}:commit`)).toHaveLength(1);
  expect(log.indexOf(`${MATCH_ID}:terminal-receipt:2`)).toBeLessThan(
    log.indexOf(`${SECOND_MATCH_ID}:fan-out`),
  );
}, 90_000);

test("the shared dispatcher advances past a pre-observation terminal marker", async () => {
  const secondFanOut = Promise.withResolvers<true>();
  const log: string[] = [];
  await harness.startWorkers({
    ...routedMatchActivities(
      createScoutV2MatchStore(),
      createScoutV2MatchStore(),
      {
        readResult: (riotMatchId) =>
          riotMatchId === MATCH_ID ? { kind: "terminal" } : undefined,
        beforeCommit: (input) => {
          log.push(`${input.riotMatchId}:commit`);
        },
        onFanOut: (riotMatchId) => {
          if (riotMatchId === SECOND_MATCH_ID) secondFanOut.resolve(true);
        },
        onTerminalReceipt: (riotMatchId) => {
          log.push(`${riotMatchId}:terminal-receipt`);
        },
      },
    ),
  });
  const workflowId = "client-match-dispatch-pre-observation-terminal";
  const dispatcher = await startDispatcher(workflowId);

  await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
    dispatchItem(MATCH_ID, 1),
    dispatchItem(SECOND_MATCH_ID, 2),
  ]);
  await secondFanOut.promise;
  await terminateDispatcher(
    workflowId,
    "test observed progress past pre-observation terminal marker",
  );

  expect(log).not.toContain(`${MATCH_ID}:commit`);
  expect(log).toContain(`${MATCH_ID}:terminal-receipt`);
  expect(log).toContain(`${SECOND_MATCH_ID}:commit`);
}, 90_000);

test("Riot readiness wakes a matching client item immediately", async () => {
  const processed = Promise.withResolvers<true>();
  await harness.startWorkers({
    ...routedMatchActivities(
      createScoutV2MatchStore(),
      createScoutV2MatchStore(),
      {
        onFanOut: (riotMatchId) => {
          if (riotMatchId === MATCH_ID) processed.resolve(true);
        },
      },
    ),
  });
  const workflowId = "client-match-dispatch-riot-readiness";
  const dispatcher = await startDispatcher(workflowId);

  await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
    dispatchItem(
      MATCH_ID,
      1,
      IsoInstantSchema.parse(new Date(Date.now() + 60_000).toISOString()),
    ),
  ]);
  const processedEarly = await Promise.race([
    processed.promise.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
  ]);
  expect(processedEarly).toBe(false);

  await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
    dispatchItem(MATCH_ID, 1, IsoInstantSchema.parse(new Date().toISOString())),
  ]);
  await processed.promise;
  await terminateDispatcher(workflowId, "test observed Riot readiness wake-up");
}, 90_000);

test("the shared dispatcher waits for authoritative legacy completion", async () => {
  const legacyStore = createScoutV2MatchStore();
  legacyStore.observed = true;
  legacyStore.owner = { kind: "legacy-v1" };
  const legacyWaiting = Promise.withResolvers<true>();
  const releaseLegacyRead = Promise.withResolvers<true>();
  const secondFanOut = Promise.withResolvers<true>();
  const log: string[] = [];
  let legacyReads = 0;
  let legacyCompleted = false;
  await harness.startWorkers({
    ...routedMatchActivities(legacyStore, createScoutV2MatchStore(), {
      legacyCompleted: () => legacyCompleted,
      onRead: async (riotMatchId) => {
        log.push(`${riotMatchId}:read`);
        if (riotMatchId !== MATCH_ID) return;
        legacyReads += 1;
        if (legacyReads === 1) {
          legacyWaiting.resolve(true);
          return;
        }
        await releaseLegacyRead.promise;
      },
      onFanOut: (riotMatchId) => {
        log.push(`${riotMatchId}:fan-out`);
        if (riotMatchId === SECOND_MATCH_ID) secondFanOut.resolve(true);
      },
    }),
  });
  const workflowId = "client-match-dispatch-legacy-drain";
  const dispatcher = await startDispatcher(workflowId);

  await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
    dispatchItem(MATCH_ID, 1),
    dispatchItem(SECOND_MATCH_ID, 2),
  ]);
  await legacyWaiting.promise;
  const overtook = await Promise.race([
    secondFanOut.promise.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
  ]);
  expect(overtook).toBe(false);

  // No fail-open receipt or cursor-association fact is required. The owning
  // legacy execution is the strict marker that all of those effects returned.
  legacyCompleted = true;
  releaseLegacyRead.resolve(true);
  await secondFanOut.promise;
  await terminateDispatcher(workflowId, "test observed legacy drain ordering");

  expect(log).not.toContain(`${MATCH_ID}:fan-out`);
  expect(legacyStore.calls).not.toContain("archiveMatchArtifactsV2");
  expect(legacyStore.calls).not.toContain("commitMatchObservationV2");
  expect(log.indexOf(`${MATCH_ID}:read`)).toBeLessThan(
    log.indexOf(`${SECOND_MATCH_ID}:fan-out`),
  );
}, 90_000);

test("keeps the active frontier monotonic when mixed evidence has an earlier timestamp", async () => {
  const olderStore = createScoutV2MatchStore();
  const newerStore = createScoutV2MatchStore();
  const newerCommitStarted = Promise.withResolvers<true>();
  const releaseNewerCommit = Promise.withResolvers<true>();
  const lateReviewRecorded = Promise.withResolvers<true>();
  const olderCommitStarted = Promise.withResolvers<true>();
  const log: string[] = [];
  await harness.startWorkers({
    ...routedMatchActivities(olderStore, newerStore, {
      beforeCommit: async (input) => {
        log.push(`${input.riotMatchId}:commit`);
        if (input.riotMatchId === MATCH_ID) olderCommitStarted.resolve(true);
        if (input.riotMatchId === SECOND_MATCH_ID) {
          newerCommitStarted.resolve(true);
          await releaseNewerCommit.promise;
        }
      },
      onTerminalReceipt: (riotMatchId) => {
        log.push(`${riotMatchId}:terminal-receipt`);
        if (riotMatchId === MATCH_ID) lateReviewRecorded.resolve(true);
      },
    }),
  });
  const workflowId = "client-match-dispatch-late-offline-review";
  const dispatcher = await startDispatcher(workflowId);

  await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
    dispatchItem(SECOND_MATCH_ID, 2),
  ]);
  await newerCommitStarted.promise;
  await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
    // A second source disagrees about the active match's end time. This must
    // not lower the frontier and admit the distinct match ending in between.
    dispatchItem(SECOND_MATCH_ID, 0),
    dispatchItem(MATCH_ID, 1),
  ]);
  releaseNewerCommit.resolve(true);
  const disposition = await Promise.race([
    lateReviewRecorded.promise.then(() => "review" as const),
    olderCommitStarted.promise.then(() => "processed" as const),
  ]);
  await terminateDispatcher(workflowId, "test observed late-arrival review");

  expect(disposition).toBe("review");
  expect(newerStore.calls).toContain("commitMatchObservationV2");
  expect(olderStore.calls).not.toContain("commitMatchObservationV2");
  expect(olderStore.calls).not.toContain("settleMatchMarketsV2");
  expect(log).toContain(`${MATCH_ID}:terminal-receipt`);
}, 90_000);

function discoveredMatch(
  riotMatchId: typeof MATCH_ID,
  gameEndTimestamp: number,
) {
  return {
    riotMatchId,
    sourcePuuid: SOURCE_PUUID,
    deliveryMode: "live" as const,
    gameEndTimestamp,
  };
}

function discoveryStartOptions(
  workflowId: string,
): WorkflowStartOptions<typeof scoutPostMatchDiscoveryV2Workflow> {
  return {
    taskQueue: "scout-dev",
    workflowId,
    args: [
      scoutPostMatchDiscoveryV2InputCodec.serialize({
        stage,
        trigger: "schedule",
      }),
    ],
  };
}

async function runDiscovery(workflowId: string) {
  return await harness
    .client()
    .workflow.execute(
      scoutPostMatchDiscoveryV2Workflow,
      discoveryStartOptions(workflowId),
    );
}

/**
 * Starts a discovery without awaiting its result. The time-skipping test
 * server only skips time while a client awaits a result, so a test that holds
 * an Activity open must not await one until it releases it; otherwise the
 * held Activity's start-to-close timeout elapses in skipped time.
 */
async function startDiscovery(workflowId: string) {
  return await harness
    .client()
    .workflow.start(
      scoutPostMatchDiscoveryV2Workflow,
      discoveryStartOptions(workflowId),
    );
}

/**
 * A discovery Activity that serves one page per scan, repeating the last, and
 * counts the scans it served.
 */
function pagedDiscovery(
  pages: readonly (readonly ReturnType<typeof discoveredMatch>[])[],
) {
  const served = { scans: 0 };
  return {
    served,
    discoverPostMatchIdsV2: () => {
      const matches = pages[Math.min(served.scans, pages.length - 1)] ?? [];
      served.scans += 1;
      return {
        outcome: "scanned",
        riotMatchIds: matches.map((match) => match.riotMatchId),
        matches,
        complete: true,
        pollOwner: POLL_OWNER,
      };
    },
  };
}

test("a rediscovered, already-processed match does not hold back the matches after it", async () => {
  // The prod shape: an account whose cursor did not move past a match its
  // completed child already processed rediscovers that match at the head of
  // every page. Its deterministic child ID is taken for good, so a discovery
  // that stops at the first refused start never reaches anything newer.
  const log: string[] = [];
  const firstStore = createScoutV2MatchStore();
  await harness.startWorkers({
    ...routedMatchActivities(firstStore, createScoutV2MatchStore(), {
      beforeCommit: (input) => {
        log.push(`${input.riotMatchId}:commit`);
      },
      onFanOut: (riotMatchId) => {
        log.push(`${riotMatchId}:fan-out`);
      },
    }),
    discoverPostMatchIdsV2: pagedDiscovery([
      [discoveredMatch(MATCH_ID, 1)],
      [discoveredMatch(MATCH_ID, 1), discoveredMatch(SECOND_MATCH_ID, 2)],
    ]).discoverPostMatchIdsV2,
    runPostMatchMaintenance: () => log.push("maintenance"),
  });

  await expect(runDiscovery("discovery-first-sighting")).resolves.toEqual(
    scoutPostMatchDiscoveryV2ResultCodec.serialize({
      status: "completed",
      discovered: 1,
      childrenStarted: 1,
      complete: true,
    }),
  );
  await expect(runDiscovery("discovery-rediscovery")).resolves.toEqual(
    scoutPostMatchDiscoveryV2ResultCodec.serialize({
      status: "completed",
      discovered: 2,
      childrenStarted: 1,
      complete: true,
    }),
  );
  await terminateDispatcher(
    scoutClientMatchDispatchV2WorkflowId(stage),
    "test observed both discovery runs",
  );

  expect(log.filter((entry) => entry === `${MATCH_ID}:commit`)).toHaveLength(1);
  expect(log).toContain(`${SECOND_MATCH_ID}:fan-out`);
  expect(log.filter((entry) => entry === "maintenance")).toHaveLength(2);
}, 90_000);

type DispatcherHistory = Awaited<
  ReturnType<ReturnType<Client["workflow"]["getHandle"]>["fetchHistory"]>
>;

/** The marker name the TypeScript SDK records `patched` calls under. */
const PATCH_MARKER = "core_patch";

const PatchMarkerDataSchema = z.strictObject({
  id: z.string(),
  deprecated: z.boolean(),
});

/**
 * Turn this patch's markers into a history that never recorded the patch.
 *
 * Core refuses a non-deprecated marker no command claims, so a plain rename
 * would fail replay on the marker itself and prove nothing about the gated
 * branch. Renamed AND deprecated, the marker is one core may skip, `patched`
 * answers false as it does for an execution that predates the gate, and any
 * nondeterminism left is the gated routing disagreeing with the history.
 */
function unrecordPatch(history: DispatcherHistory, patchId: string): number {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let rewritten = 0;
  for (const event of history.events ?? []) {
    const marker = event.markerRecordedEventAttributes;
    if (marker?.markerName !== PATCH_MARKER) continue;
    for (const payloads of Object.values(marker.details ?? {})) {
      for (const payload of payloads.payloads ?? []) {
        const data = PatchMarkerDataSchema.parse(
          JSON.parse(decoder.decode(payload.data ?? new Uint8Array())),
        );
        if (data.id !== patchId) continue;
        payload.data = encoder.encode(
          JSON.stringify({ id: `${patchId}-unrecorded`, deprecated: true }),
        );
        rewritten += 1;
      }
    }
  }
  return rewritten;
}

test("processes an older Riot match another account's poll delivered after a newer one", async () => {
  // The prod shape: discovery polls a rotating subset of accounts, and each
  // account's cursor is its own. One run hands over account A's newer match;
  // while it is being processed the next run's page carries account B's older
  // match. Refusing it as a late arrival never advanced B's cursor, failed
  // every later run, and lost the match once B played again.
  const otherPuuid = LeaguePuuidSchema.parse("t".repeat(78));
  const log: string[] = [];
  const olderStore = createScoutV2MatchStore();
  const newerStore = createScoutV2MatchStore();
  const newerCommitStarted = Promise.withResolvers<true>();
  const releaseNewerCommit = Promise.withResolvers<true>();
  const discovery = pagedDiscovery([
    [discoveredMatch(SECOND_MATCH_ID, 2)],
    [{ ...discoveredMatch(MATCH_ID, 1), sourcePuuid: otherPuuid }],
  ]);
  await harness.startWorkers({
    ...routedMatchActivities(olderStore, newerStore, {
      beforeCommit: async (input) => {
        log.push(`${input.riotMatchId}:commit`);
        if (input.riotMatchId === SECOND_MATCH_ID) {
          newerCommitStarted.resolve(true);
          await releaseNewerCommit.promise;
        }
      },
      onTerminalReceipt: (riotMatchId) => {
        log.push(`${riotMatchId}:terminal-receipt`);
      },
    }),
    discoverPostMatchIdsV2: discovery.discoverPostMatchIdsV2,
    runPostMatchMaintenance: (input: { settleDareV2Deadlines: boolean }) => {
      log.push(`maintenance:settle=${String(input.settleDareV2Deadlines)}`);
    },
  });

  const dispatcherId = scoutClientMatchDispatchV2WorkflowId(stage);
  const dispatcher = harness.client().workflow.getHandle(dispatcherId);
  // Started, not executed: nothing awaits a result while the newer commit is
  // held, so the test server cannot skip past its start-to-close timeout.
  const newer = await startDiscovery("discovery-newer-account");
  await newerCommitStarted.promise;
  const older = await startDiscovery("discovery-older-account");
  // Hold the newer match until the older one has been signalled, so the
  // dispatcher sees it behind a frontier that is already past it.
  for (;;) {
    const recorded = await dispatcher.fetchHistory();
    const signals = (recorded.events ?? []).filter(
      (event) => event.workflowExecutionSignaledEventAttributes != null,
    );
    if (signals.length >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  releaseNewerCommit.resolve(true);

  const completed = scoutPostMatchDiscoveryV2ResultCodec.serialize({
    status: "completed",
    discovered: 1,
    childrenStarted: 1,
    complete: true,
  });
  await expect(newer.result()).resolves.toEqual(completed);
  await expect(older.result()).resolves.toEqual(completed);
  const history = await dispatcher.fetchHistory();
  await terminateDispatcher(dispatcherId, "test observed both discoveries");

  expect(discovery.served.scans).toBe(2);
  expect(log).not.toContain(`${MATCH_ID}:terminal-receipt`);
  expect(olderStore.calls).toContain("commitMatchObservationV2");
  expect(olderStore.calls).toContain("advanceMatchCursorV2");
  expect(log.filter((entry) => entry.startsWith("maintenance"))).toEqual([
    "maintenance:settle=true",
    "maintenance:settle=true",
  ]);

  // Replay safety. The recorded history carries the gate's marker and replays
  // cleanly. With that marker renamed it is what an execution predating the
  // gate would hold here, so the code takes the old review path and disagrees
  // with the recorded child start. That disagreement proves the gate, not the
  // new routing alone, decides what an open history replays.
  const workflowsPath = new URL("index.ts", import.meta.url).pathname;
  await Worker.runReplayHistory({ workflowsPath }, history, dispatcherId);
  const withoutGate = structuredClone(history);
  expect(
    unrecordPatch(withoutGate, SCOUT_V2_DISPATCH_RIOT_BYPASSES_WATERMARK_PATCH),
  ).toBe(1);
  const replayed = Worker.runReplayHistory(
    { workflowsPath },
    withoutGate,
    dispatcherId,
  );
  await expect(replayed).rejects.toMatchObject({
    name: "DeterminismViolationError",
  });
  await expect(replayed).rejects.not.toThrow(/patch marker/u);
}, 120_000);

test("processes a queued client late arrival once Riot discovers it too", async () => {
  // A client-only offline sighting sorts behind the frontier and is queued for
  // review. Before its marker is written, Riot discovers the same match. Riot
  // vouches for it, so it is processed in order instead of refused.
  const olderStore = createScoutV2MatchStore();
  const newerStore = createScoutV2MatchStore();
  const newerCommitStarted = Promise.withResolvers<true>();
  const releaseNewerCommit = Promise.withResolvers<true>();
  const olderFanOut = Promise.withResolvers<true>();
  const log: string[] = [];
  await harness.startWorkers({
    ...routedMatchActivities(olderStore, newerStore, {
      beforeCommit: async (input) => {
        if (input.riotMatchId === SECOND_MATCH_ID) {
          newerCommitStarted.resolve(true);
          await releaseNewerCommit.promise;
        }
      },
      onFanOut: (riotMatchId) => {
        if (riotMatchId === MATCH_ID) olderFanOut.resolve(true);
      },
      onTerminalReceipt: (riotMatchId) => {
        log.push(`${riotMatchId}:terminal-receipt`);
      },
    }),
  });
  const workflowId = "client-match-dispatch-late-then-riot";
  const dispatcher = await startDispatcher(workflowId);

  await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
    dispatchItem(SECOND_MATCH_ID, 2),
  ]);
  await newerCommitStarted.promise;
  await dispatcher.signal(dispatchScoutClientMatchesV2Signal, [
    dispatchItem(MATCH_ID, 1),
    {
      ...dispatchItem(MATCH_ID, 1),
      completionTargets: [{ workflowId: "riot-discovery", runId: "run-1" }],
    },
  ]);
  releaseNewerCommit.resolve(true);
  await olderFanOut.promise;
  await terminateDispatcher(workflowId, "test observed the promoted match");

  expect(olderStore.calls).toContain("commitMatchObservationV2");
  expect(log).not.toContain(`${MATCH_ID}:terminal-receipt`);
}, 90_000);
