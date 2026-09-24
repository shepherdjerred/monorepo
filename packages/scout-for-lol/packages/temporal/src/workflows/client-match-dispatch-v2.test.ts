import { describe, expect, test } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
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

async function terminateDispatcher(workflowId: string, reason: string) {
  await harness.client().workflow.getHandle(workflowId).terminate(reason);
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

async function runDiscovery(workflowId: string) {
  return await harness
    .client()
    .workflow.execute(scoutPostMatchDiscoveryV2Workflow, {
      taskQueue: "scout-dev",
      workflowId,
      args: [
        scoutPostMatchDiscoveryV2InputCodec.serialize({
          stage,
          trigger: "schedule",
        }),
      ],
    });
}

test("a rediscovered, already-processed match does not hold back the matches after it", async () => {
  // The prod shape: an account whose cursor did not move past a match its
  // completed child already processed rediscovers that match at the head of
  // every page. Its deterministic child ID is taken for good, so a discovery
  // that stops at the first refused start never reaches anything newer.
  const log: string[] = [];
  const firstStore = createScoutV2MatchStore();
  const pages = [
    [discoveredMatch(MATCH_ID, 1)],
    [discoveredMatch(MATCH_ID, 1), discoveredMatch(SECOND_MATCH_ID, 2)],
  ];
  let scans = 0;
  await harness.startWorkers({
    ...routedMatchActivities(firstStore, createScoutV2MatchStore(), {
      beforeCommit: (input) => {
        log.push(`${input.riotMatchId}:commit`);
      },
      onFanOut: (riotMatchId) => {
        log.push(`${riotMatchId}:fan-out`);
      },
    }),
    discoverPostMatchIdsV2: () => {
      const matches = pages[Math.min(scans, pages.length - 1)] ?? [];
      scans += 1;
      return {
        outcome: "scanned",
        riotMatchIds: matches.map((match) => match.riotMatchId),
        matches,
        complete: true,
        pollOwner: POLL_OWNER,
      };
    },
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
