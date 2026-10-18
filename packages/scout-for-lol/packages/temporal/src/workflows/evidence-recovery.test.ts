import { expect, test } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  scoutMatchProcessingInputCodec,
  scoutClientMatchDispatchInputCodec,
} from "#src/workflow-contracts.ts";
import {
  scoutMatchProcessingWorkflow,
  scoutClientMatchDispatchWorkflow,
} from "./index.ts";
import {
  createScoutMatchStore,
  scoutMatchActivityStubs,
  MATCH_ID,
} from "./match.test-fixtures.ts";
import { useScoutWorkflowHarness } from "./workflow-harness.test-fixtures.ts";
import {
  expectRetiredGatesReplay,
  recordedPatchMarkers,
} from "./retired-patches.test-fixtures.ts";
import {
  SCOUT_ARCHIVE_ONLY_NO_EFFECTS_PATCH,
  SCOUT_MATCH_EVIDENCE_PREPARATION_PATCH,
} from "./evidence/match.ts";
import {
  SCOUT_DISCOVERED_HISTORY_ANCHOR_PATCH,
  SCOUT_HISTORY_DISPATCH_BACKGROUND_PATCH,
} from "./evidence/dispatch.ts";
import { SCOUT_MATCH_RECEIPT_KINDS } from "#src/match-receipts.ts";

const harness = useScoutWorkflowHarness("beta");
const SOURCE_PUUID = LeaguePuuidSchema.parse("s".repeat(78));

test("beta waits durably for timeline recovery before effects and replays its new commands", async () => {
  const store = createScoutMatchStore();
  let preparations = 0;
  const deadline = IsoInstantSchema.parse(
    new Date(Date.now() + 120_000).toISOString(),
  );
  await harness.startWorkers({
    ...scoutMatchActivityStubs(store),
    prepareMatchEvidence: async () => {
      preparations += 1;
      store.calls.push("prepareMatchEvidence");
      return preparations < 3
        ? { kind: "pending", retryAt: deadline }
        : { kind: "ready" };
    },
  });
  const handle = await harness
    .client()
    .workflow.start(scoutMatchProcessingWorkflow, {
      workflowId: "beta-evidence-recovery",
      taskQueue: "scout-beta",
      args: [
        scoutMatchProcessingInputCodec.serialize({
          stage: "beta",
          riotMatchId: MATCH_ID,
          deliveryMode: "live",
        }),
      ],
    });
  await handle.result();
  expect(preparations).toBe(3);
  expect(store.calls.lastIndexOf("prepareMatchEvidence")).toBeLessThan(
    store.calls.indexOf("settleMatchMarkets"),
  );
  const history = await handle.fetchHistory();
  expect(
    history.events?.filter(
      (event) => event.timerStartedEventAttributes != null,
    ),
  ).toHaveLength(2);
  // A FULL match never reaches the archive-only decision.
  expect(
    recordedPatchMarkers(history, [SCOUT_ARCHIVE_ONLY_NO_EFFECTS_PATCH]),
  ).toEqual({});
  await expectRetiredGatesReplay(history, [
    SCOUT_MATCH_EVIDENCE_PREPARATION_PATCH,
  ]);
}, 60_000);

test("beta archive-only work skips tournament finalization and replays as the gated release", async () => {
  const store = createScoutMatchStore({ policy: "ARCHIVE_ONLY" });
  await harness.startWorkers(scoutMatchActivityStubs(store));
  const handle = await harness
    .client()
    .workflow.start(scoutMatchProcessingWorkflow, {
      workflowId: "beta-archive-only",
      taskQueue: "scout-beta",
      args: [
        scoutMatchProcessingInputCodec.serialize({
          stage: "beta",
          riotMatchId: MATCH_ID,
          deliveryMode: "live",
        }),
      ],
    });
  await handle.result();
  expect(store.calls).not.toContain("finalizeTournamentResult");
  expect(store.calls).not.toContain("settleMatchMarkets");
  const history = await handle.fetchHistory();
  // Evidence preparation gates only FULL work.
  expect(
    recordedPatchMarkers(history, [SCOUT_MATCH_EVIDENCE_PREPARATION_PATCH]),
  ).toEqual({});
  await expectRetiredGatesReplay(history, [
    SCOUT_ARCHIVE_ONLY_NO_EFFECTS_PATCH,
  ]);
}, 60_000);

test("beta dispatch anchors an already-complete archive-only match and replays as the gated release", async () => {
  const store = createScoutMatchStore({
    observed: true,
    policy: "ARCHIVE_ONLY",
    receiptKinds: [
      SCOUT_MATCH_RECEIPT_KINDS.archive,
      SCOUT_MATCH_RECEIPT_KINDS.observation,
    ],
    cursorAdvanced: 2,
  });
  const anchored = Promise.withResolvers<true>();
  const stubs = scoutMatchActivityStubs(store);
  await harness.startWorkers({
    ...stubs,
    queueHistoryMatch: async () => {
      throw new Error("a live item must not be queued as history");
    },
    advanceMatchCursor: () => {
      const result = stubs.advanceMatchCursor();
      anchored.resolve(true);
      return result;
    },
  });
  const workflowId = "beta-dispatch-history-anchor";
  const handle = await harness
    .client()
    .workflow.start(scoutClientMatchDispatchWorkflow, {
      workflowId,
      taskQueue: "scout-beta",
      args: [
        scoutClientMatchDispatchInputCodec.serialize({
          stage: "beta",
          orderingWatermark: null,
          lateArrivals: [],
          pending: [
            {
              riotMatchId: MATCH_ID,
              sourcePuuid: SOURCE_PUUID,
              deliveryMode: "live",
              gameEndTimestamp: 1000,
              readyAt: IsoInstantSchema.parse("2026-10-13T00:00:00Z"),
              completionTargets: [],
              orderingAssured: true,
            },
          ],
        }),
      ],
    });
  await anchored.promise;
  await harness.sleep("1 second");
  const history = await handle.fetchHistory();
  await handle.terminate("verified the discovered history anchor");

  expect(store.calls).not.toContain("commitMatchObservation");
  expect(store.calls).toContain("advanceMatchCursor");
  await expectRetiredGatesReplay(
    history,
    [
      SCOUT_HISTORY_DISPATCH_BACKGROUND_PATCH,
      SCOUT_ARCHIVE_ONLY_NO_EFFECTS_PATCH,
      SCOUT_DISCOVERED_HISTORY_ANCHOR_PATCH,
    ],
    workflowId,
  );
}, 60_000);

test("historical arrivals bypass the live watermark and enqueue no match-effect children", async () => {
  const queued = Promise.withResolvers<string>();
  await harness.startWorkers({
    queueHistoryMatch: async (input: { riotMatchId: string }) => {
      queued.resolve(input.riotMatchId);
    },
  });
  const handle = await harness
    .client()
    .workflow.start(scoutClientMatchDispatchWorkflow, {
      workflowId: "beta-history-dispatch",
      taskQueue: "scout-beta",
      args: [
        scoutClientMatchDispatchInputCodec.serialize({
          stage: "beta",
          orderingWatermark: {
            riotMatchId: RiotMatchIdSchema.parse("NA1_9999"),
            gameEndTimestamp: 2000,
          },
          lateArrivals: [
            {
              riotMatchId: MATCH_ID,
              sourcePuuid: SOURCE_PUUID,
              deliveryMode: "silent-backfill",
              gameEndTimestamp: 1000,
              readyAt: IsoInstantSchema.parse("2026-10-13T00:00:00Z"),
              completionTargets: [],
              orderingAssured: false,
            },
          ],
          pending: [],
        }),
      ],
    });
  expect(await queued.promise).toBe(MATCH_ID);
  await harness.sleep("1 second");
  const history = await handle.fetchHistory();
  expect(
    history.events?.some(
      (event) =>
        event.startChildWorkflowExecutionInitiatedEventAttributes != null,
    ),
  ).toBe(false);
  await handle.terminate("verified durable history admission");
  await expectRetiredGatesReplay(
    history,
    [SCOUT_HISTORY_DISPATCH_BACKGROUND_PATCH],
    "beta-history-dispatch",
  );
}, 60_000);
