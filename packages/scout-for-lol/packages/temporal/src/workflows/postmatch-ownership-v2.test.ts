import { describe, expect, test } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type {
  ScoutPostMatchDiscoveryOwnerV2Result,
  ScoutPostMatchScanV2Result,
} from "#src/activity-contracts-v2.ts";
import {
  scoutPostMatchDiscoveryV2InputCodec,
  scoutPostMatchDiscoveryV2ResultCodec,
} from "#src/workflow-contracts-v2.ts";
import { scoutPostMatchDiscoveryV2Workflow } from "./index.ts";
import {
  createScoutV2MatchStore,
  scoutV2MatchActivityStubs,
  MATCH_ID,
} from "./match-v2.test-fixtures.ts";
import { legacyPostMatchDiscoveryWorkflowId } from "./postmatch-ownership-v2.ts";
import {
  settleWorkflow,
  useScoutV2WorkflowHarness,
} from "./workflow-harness.test-fixtures.ts";

const harness = useScoutV2WorkflowHarness();

const stage = "dev" as const;
// The claim V2 discovery takes in its own scan.
const POLL_OWNER = IsoInstantSchema.parse("2026-09-23T07:59:00.000Z");
// The claim the v1 handoff takes before its child starts.
const HANDOFF_CLAIM = IsoInstantSchema.parse("2026-09-23T08:00:00.000Z");
const SOURCE_PUUID = LeaguePuuidSchema.parse("s".repeat(78));
const LEGACY_MATCHES = ["NA1_100", "NA1_101"];

const DELEGATE: ScoutPostMatchDiscoveryOwnerV2Result = {
  decision: "delegate-v1",
  pollOwner: HANDOFF_CLAIM,
};

/**
 * Both pipelines' discovery and ingestion Activities on one worker, each
 * logging the call and the poll claim it was handed, so a test can see which
 * pipeline did the work and under which claim.
 */
function bothPipelines(
  owner: ScoutPostMatchDiscoveryOwnerV2Result,
  calls: string[],
  options: { failLegacyIngest?: boolean } = {},
) {
  const store = createScoutV2MatchStore();
  return {
    ...scoutV2MatchActivityStubs(store),
    resolvePostMatchDiscoveryOwnerV2: () => {
      calls.push("resolvePostMatchDiscoveryOwnerV2");
      return owner;
    },
    releasePostMatchPollClaimV2: (input: { pollOwner: string }) => {
      calls.push(`releasePostMatchPollClaimV2:${input.pollOwner}`);
      return { outcome: "released" };
    },
    discoverPostMatchIdsV2: (): ScoutPostMatchScanV2Result => {
      calls.push("discoverPostMatchIdsV2");
      return {
        outcome: "scanned",
        riotMatchIds: [MATCH_ID],
        matches: [
          {
            riotMatchId: MATCH_ID,
            sourcePuuid: SOURCE_PUUID,
            deliveryMode: "live",
          },
        ],
        complete: true,
        pollOwner: POLL_OWNER,
      };
    },
    discoverPostMatchIds: (input: { pollOwner?: string }) => {
      calls.push(`discoverPostMatchIds:${input.pollOwner ?? "unclaimed"}`);
      return {
        evidenceComplete: true,
        matches: LEGACY_MATCHES.map((matchId) => ({
          matchId,
          sourcePuuid: `puuid-${matchId}`,
          region: "AMERICA_NORTH",
          delivery: "live",
        })),
      };
    },
    ingestMatch: (input: { matchId: string }) => {
      calls.push(`ingestMatch:${input.matchId}`);
      if (options.failLegacyIngest === true) {
        throw ApplicationFailure.nonRetryable(
          `injected ingest failure for ${input.matchId}`,
          "InjectedCrash",
        );
      }
    },
    runPostMatchMaintenance: (input: { pollOwner?: string }) => {
      calls.push(`runPostMatchMaintenance:${input.pollOwner ?? "unclaimed"}`);
    },
  };
}

async function discover(workflowId: string): Promise<unknown> {
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

describe("post-match discovery ownership", () => {
  test("runs V2 discovery when V2 owns the pass, and never starts v1", async () => {
    const calls: string[] = [];
    await harness.startWorkers(bothPipelines({ decision: "run-v2" }, calls));

    const result = await discover("ownership-v2");

    expect(calls[0]).toBe("resolvePostMatchDiscoveryOwnerV2");
    expect(calls).toContain("discoverPostMatchIdsV2");
    expect(calls).toContain(`runPostMatchMaintenance:${POLL_OWNER}`);
    expect(calls.some((call) => call.startsWith("discoverPostMatchIds:"))).toBe(
      false,
    );
    expect(calls.filter((call) => call.startsWith("ingestMatch"))).toEqual([]);
    expect(result).toEqual(
      scoutPostMatchDiscoveryV2ResultCodec.serialize({
        status: "completed",
        discovered: 1,
        childrenStarted: 1,
        complete: true,
      }),
    );
  }, 90_000);

  test("runs v1 under the handoff's claim when v1 owns the pass", async () => {
    const calls: string[] = [];
    await harness.startWorkers(bothPipelines(DELEGATE, calls));

    const result = await discover("ownership-v1");

    const legacyId = legacyPostMatchDiscoveryWorkflowId("ownership-v1");
    // v1 discovers and closes under exactly the claim the handoff took, so
    // its open cannot clobber that claim and its close cannot land on
    // another run's poll. No V2 discovery runs, and nothing is released
    // because v1's own maintenance closed the claim.
    expect(calls).toEqual([
      "resolvePostMatchDiscoveryOwnerV2",
      `discoverPostMatchIds:${HANDOFF_CLAIM}`,
      "ingestMatch:NA1_100",
      "ingestMatch:NA1_101",
      `runPostMatchMaintenance:${HANDOFF_CLAIM}`,
    ]);
    expect(result).toEqual(
      scoutPostMatchDiscoveryV2ResultCodec.serialize({
        status: "completed",
        discovered: 0,
        childrenStarted: 0,
        complete: false,
        delegatedTo: {
          workflowType: "scoutPostMatchDiscoveryWorkflow",
          workflowId: legacyId,
          childrenStarted: 2,
        },
      }),
    );
    // The pass ran as a real v1 execution, visible under v1's own type.
    const legacy = await harness
      .client()
      .workflow.getHandle(legacyId)
      .describe();
    expect(legacy.type).toBe("scoutPostMatchDiscoveryWorkflow");
    expect(legacy.status.name).toBe("COMPLETED");
  }, 90_000);

  test("releases the handoff's claim when the v1 pass fails", async () => {
    const calls: string[] = [];
    await harness.startWorkers(
      bothPipelines(DELEGATE, calls, { failLegacyIngest: true }),
    );

    const settled = await settleWorkflow(discover("ownership-v1-failed"));

    expect(settled).toBeInstanceOf(Error);
    expect(calls.at(-1)).toBe(`releasePostMatchPollClaimV2:${HANDOFF_CLAIM}`);
  }, 90_000);

  test("does nothing when v1 owns the pass but another run holds the claim", async () => {
    const calls: string[] = [];
    await harness.startWorkers(
      bothPipelines({ decision: "defer-v1", pollHeldSince: POLL_OWNER }, calls),
    );

    const result = await discover("ownership-deferred");

    // Neither pipeline discovers, and nothing closes the claim another run
    // still holds.
    expect(calls).toEqual(["resolvePostMatchDiscoveryOwnerV2"]);
    expect(result).toEqual(
      scoutPostMatchDiscoveryV2ResultCodec.serialize({
        status: "no-op",
        discovered: 0,
        childrenStarted: 0,
        complete: false,
      }),
    );
  }, 90_000);
});
