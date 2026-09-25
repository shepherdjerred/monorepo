import { describe, expect, test } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { WorkflowFailedError, type WorkflowHandle } from "@temporalio/client";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutPrematchPassOwnerV2Result } from "#src/activity-contracts-v2.ts";
import type { ScoutRealtimePollInput } from "#src/contracts.ts";
import { scoutPrematchDiscoveryV2WorkflowId } from "#src/identifiers.ts";
import { scoutRealtimePollWorkflow } from "#src/workflows/index.ts";
import {
  createScoutV2PrematchStore,
  scoutV2PrematchActivityStubs,
} from "#src/workflows/prematch-v2.test-fixtures.ts";
import {
  settleWorkflow,
  useScoutV2WorkflowHarness,
} from "#src/workflows/workflow-harness.test-fixtures.ts";
import { SCOUT_V2_PREMATCH_OWNERSHIP_PATCH } from "./prematch-ownership-v2.ts";

const harness = useScoutV2WorkflowHarness();

type History = Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>;

const HOLDER = "prematch-pass-holder-run";
const CLAIMED_AT = IsoInstantSchema.parse("2026-09-25T06:00:00.000Z");
const PREMATCH_POLL: ScoutRealtimePollInput = {
  stage: "dev",
  kind: "prematch",
  maximumAgeSeconds: 90,
};
const RUN_V1: ScoutPrematchPassOwnerV2Result = {
  decision: "run-v1",
  holder: HOLDER,
  claimedAt: CLAIMED_AT,
};
const RUN_V2: ScoutPrematchPassOwnerV2Result = {
  decision: "run-v2",
  holder: HOLDER,
  claimedAt: CLAIMED_AT,
};

/**
 * Both pipelines' prematch Activities on one worker, each logging the call,
 * so a test can see which pipeline did the work and under which claim.
 */
function bothPipelines(
  owner: ScoutPrematchPassOwnerV2Result,
  calls: string[],
  polls: unknown[] = [],
) {
  const store = createScoutV2PrematchStore();
  const v2 = scoutV2PrematchActivityStubs(store);
  return {
    ...v2,
    discoverPrematchGamesV2: () => {
      calls.push("discoverPrematchGamesV2");
      return v2.discoverPrematchGamesV2();
    },
    resolvePrematchPassOwnerV2: () => {
      calls.push("resolvePrematchPassOwnerV2");
      return owner;
    },
    renewPrematchPassClaimV2: (input: { holder: string }) => {
      calls.push(`renewPrematchPassClaimV2:${input.holder}`);
      return { outcome: "renewed" };
    },
    releasePrematchPassClaimV2: (input: { holder: string }) => {
      calls.push(`releasePrematchPassClaimV2:${input.holder}`);
      return { outcome: "released" };
    },
    pollRealtime: (input: { activeGameDetectionOwner?: string }) => {
      polls.push(input);
      calls.push(`pollRealtime:${input.activeGameDetectionOwner ?? "v1"}`);
    },
  };
}

async function startPoll(
  workflowId: string,
  input: ScoutRealtimePollInput = PREMATCH_POLL,
) {
  return await harness.client().workflow.start(scoutRealtimePollWorkflow, {
    taskQueue: "scout-dev",
    workflowId,
    args: [input],
  });
}

function scheduledActivities(history: History) {
  return (history.events ?? []).flatMap((event) => {
    const scheduled = event.activityTaskScheduledEventAttributes;
    return scheduled == null ? [] : [scheduled];
  });
}

function startInput(history: History) {
  return history.events?.[0]?.workflowExecutionStartedEventAttributes?.input
    ?.payloads?.[0]?.data;
}

function pollOf(history: History) {
  const poll = scheduledActivities(history).find(
    (scheduled) => scheduled.activityType?.name === "pollRealtime",
  );
  if (poll === undefined) throw new Error("no pollRealtime scheduled");
  return poll;
}

function scheduledTypes(history: History): string[] {
  return scheduledActivities(history).map(
    (scheduled) => scheduled.activityType?.name ?? "",
  );
}

function recordsPatch(history: History): boolean {
  const decoder = new TextDecoder();
  return (history.events ?? []).some((event) => {
    const marker = event.markerRecordedEventAttributes;
    return (
      marker?.markerName === "core_patch" &&
      Object.values(marker.details ?? {}).some((payloads) =>
        (payloads.payloads ?? []).some((payload) =>
          decoder
            .decode(payload.data ?? new Uint8Array())
            .includes(SCOUT_V2_PREMATCH_OWNERSHIP_PATCH),
        ),
      )
    );
  });
}

describe("prematch pass ownership", () => {
  test("runs v1's pass unchanged when v1 owns it, under the pass claim", async () => {
    const calls: string[] = [];
    await harness.startWorkers(bothPipelines(RUN_V1, calls));

    const handle = await startPoll("prematch-ownership-v1");
    const result = await handle.result();
    const history = await handle.fetchHistory();

    expect(result).toBe("completed");
    expect(calls).toEqual([
      "resolvePrematchPassOwnerV2",
      "pollRealtime:v1",
      `releasePrematchPassClaimV2:${HOLDER}`,
    ]);
    expect(recordsPatch(history)).toBe(true);
    expect(scheduledTypes(history)).toEqual([
      "resolvePrematchPassOwnerV2",
      "pollRealtime",
      "releasePrematchPassClaimV2",
    ]);
  }, 90_000);

  test("hands v1 byte-for-byte the pollRealtime command it ran before the router", async () => {
    // Before the router, the prematch arm scheduled `pollRealtime` with the
    // parsed Workflow input, whose JSON is the Workflow's own input bytes.
    // Flag off must schedule that same command: same Activity, same queue,
    // same payload bytes, same timeouts and retry policy as a tournament-lobby
    // poll, which the router never touches.
    const calls: string[] = [];
    await harness.startWorkers(bothPipelines(RUN_V1, calls));

    const routed = await startPoll("prematch-ownership-v1-bytes");
    await routed.result();
    const unrouted = await startPoll("prematch-ownership-unrouted", {
      ...PREMATCH_POLL,
      kind: "tournament-lobbies",
    });
    await unrouted.result();

    const routedHistory = await routed.fetchHistory();
    const unroutedHistory = await unrouted.fetchHistory();
    const routedPoll = pollOf(routedHistory);
    const unroutedPoll = pollOf(unroutedHistory);

    expect(routedPoll.input?.payloads?.[0]?.data).toEqual(
      startInput(routedHistory),
    );
    expect(unroutedPoll.input?.payloads?.[0]?.data).toEqual(
      startInput(unroutedHistory),
    );
    expect(routedPoll.taskQueue?.name).toBe(unroutedPoll.taskQueue?.name);
    expect(routedPoll.scheduleToCloseTimeout).toEqual(
      unroutedPoll.scheduleToCloseTimeout,
    );
    expect(routedPoll.startToCloseTimeout).toEqual(
      unroutedPoll.startToCloseTimeout,
    );
    expect(routedPoll.heartbeatTimeout).toEqual(unroutedPoll.heartbeatTimeout);
    expect(routedPoll.retryPolicy).toEqual(unroutedPoll.retryPolicy);
  }, 90_000);

  test("runs V2 discovery as a child and keeps only v1's maintenance when V2 owns the pass", async () => {
    const calls: string[] = [];
    const polls: unknown[] = [];
    await harness.startWorkers(bothPipelines(RUN_V2, calls, polls));

    const handle = await startPoll("prematch-ownership-v2");
    const result = await handle.result();
    const history = await handle.fetchHistory();

    expect(result).toBe("completed");
    const pass = calls.filter(
      (call) =>
        call === "resolvePrematchPassOwnerV2" ||
        call === "discoverPrematchGamesV2" ||
        call.startsWith("pollRealtime") ||
        call.startsWith("releasePrematchPassClaimV2"),
    );
    expect(pass).toEqual([
      "resolvePrematchPassOwnerV2",
      "discoverPrematchGamesV2",
      "pollRealtime:v2",
      `releasePrematchPassClaimV2:${HOLDER}`,
    ]);
    expect(polls).toEqual([
      { ...PREMATCH_POLL, activeGameDetectionOwner: "v2" },
    ]);
    const child = (history.events ?? []).find(
      (event) =>
        event.startChildWorkflowExecutionInitiatedEventAttributes != null,
    )?.startChildWorkflowExecutionInitiatedEventAttributes;
    expect(child?.workflowType?.name).toBe("scoutPrematchDiscoveryV2Workflow");
    expect(child?.workflowId).toBe(scoutPrematchDiscoveryV2WorkflowId("dev"));
  }, 90_000);

  test("does nothing while another run holds the pass", async () => {
    const calls: string[] = [];
    await harness.startWorkers(
      bothPipelines({ decision: "defer", heldSince: CLAIMED_AT }, calls),
    );

    const handle = await startPoll("prematch-ownership-defer");
    const result = await handle.result();

    expect(result).toBe("no-op");
    expect(calls).toEqual(["resolvePrematchPassOwnerV2"]);
  }, 90_000);

  test("releases the claim when the pass fails, then fails", async () => {
    const calls: string[] = [];
    await harness.startWorkers({
      ...bothPipelines(RUN_V1, calls),
      pollRealtime: () => {
        calls.push("pollRealtime:v1");
        throw ApplicationFailure.nonRetryable(
          "injected prematch failure",
          "InjectedCrash",
        );
      },
    });

    const handle = await startPoll("prematch-ownership-fails");
    const settled = await settleWorkflow(handle.result());

    expect(settled).toBeInstanceOf(WorkflowFailedError);
    expect(calls).toEqual([
      "resolvePrematchPassOwnerV2",
      "pollRealtime:v1",
      `releasePrematchPassClaimV2:${HOLDER}`,
    ]);
  }, 90_000);

  test("renews the claim for as long as a slow pass runs", async () => {
    // The first attempt asks for a 150-second retry delay, so the pass stays
    // open for 2.5 minutes of skipped Workflow time: two renewals at the
    // one-minute interval, both before the pass finishes.
    const calls: string[] = [];
    let attempted = false;
    await harness.startWorkers({
      ...bothPipelines(RUN_V1, calls),
      pollRealtime: () => {
        calls.push("pollRealtime:v1");
        if (attempted) return;
        attempted = true;
        throw ApplicationFailure.create({
          message: "slow prematch pass",
          type: "SlowPass",
          nextRetryDelay: "150 seconds",
        });
      },
    });

    const handle = await startPoll("prematch-ownership-slow");
    const result = await handle.result();

    expect(result).toBe("completed");
    const renewal = `renewPrematchPassClaimV2:${HOLDER}`;
    expect(calls.filter((call) => call === renewal)).toHaveLength(2);
    expect(calls.indexOf(renewal)).toBeLessThan(
      calls.lastIndexOf("pollRealtime:v1"),
    );
    expect(calls.at(-1)).toBe(`releasePrematchPassClaimV2:${HOLDER}`);
  }, 90_000);

  test("never routes a tournament-lobby poll", async () => {
    const calls: string[] = [];
    await harness.startWorkers(bothPipelines(RUN_V2, calls));

    const handle = await startPoll("prematch-ownership-tournament", {
      ...PREMATCH_POLL,
      kind: "tournament-lobbies",
    });
    await handle.result();
    const history = await handle.fetchHistory();

    expect(calls).toEqual(["pollRealtime:v1"]);
    expect(recordsPatch(history)).toBe(false);
    expect(scheduledTypes(history)).toEqual(["pollRealtime"]);
  }, 90_000);
});
