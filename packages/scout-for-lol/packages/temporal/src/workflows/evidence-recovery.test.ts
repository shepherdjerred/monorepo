import { expect, test } from "vitest";
import { Worker } from "@temporalio/worker";
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

const harness = useScoutWorkflowHarness("beta");

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
  await Worker.runReplayHistory(
    { workflowsPath: new URL("index.ts", import.meta.url).pathname },
    history,
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
              sourcePuuid: LeaguePuuidSchema.parse("s".repeat(78)),
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
}, 60_000);
