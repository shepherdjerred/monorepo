import { describe, expect, test } from "vitest";
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
import { useScoutV2WorkflowHarness } from "./workflow-harness.test-fixtures.ts";

const harness = useScoutV2WorkflowHarness();

const stage = "dev" as const;
const POLL_OWNER = IsoInstantSchema.parse("2026-09-23T07:59:00.000Z");
const SOURCE_PUUID = LeaguePuuidSchema.parse("s".repeat(78));
const LEGACY_MATCHES = ["NA1_100", "NA1_101"];

/**
 * Both pipelines' discovery and ingestion Activities on one worker, each
 * logging the call, so a test can see which pipeline did the work.
 */
function bothPipelines(
  owner: ScoutPostMatchDiscoveryOwnerV2Result,
  calls: string[],
) {
  const store = createScoutV2MatchStore();
  return {
    ...scoutV2MatchActivityStubs(store),
    resolvePostMatchDiscoveryOwnerV2: () => {
      calls.push("resolvePostMatchDiscoveryOwnerV2");
      return owner;
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
    discoverPostMatchIds: () => {
      calls.push("discoverPostMatchIds");
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
    },
    runPostMatchMaintenance: (input: { pollOwner?: string }) => {
      calls.push(
        input.pollOwner === undefined
          ? "runPostMatchMaintenance:v1"
          : "runPostMatchMaintenance:v2",
      );
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
    expect(calls).toContain("runPostMatchMaintenance:v2");
    expect(calls).not.toContain("discoverPostMatchIds");
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

  test("hands the pass to v1 discovery when v1 owns it, and runs no V2 discovery", async () => {
    const calls: string[] = [];
    await harness.startWorkers(
      bothPipelines({ decision: "delegate-v1" }, calls),
    );

    const result = await discover("ownership-v1");

    const legacyId = legacyPostMatchDiscoveryWorkflowId("ownership-v1");
    expect(calls).toEqual([
      "resolvePostMatchDiscoveryOwnerV2",
      "discoverPostMatchIds",
      "ingestMatch:NA1_100",
      "ingestMatch:NA1_101",
      "runPostMatchMaintenance:v1",
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

  test("defers when v1 owns the pass but a poll still holds the row", async () => {
    const calls: string[] = [];
    await harness.startWorkers(
      bothPipelines({ decision: "defer-v1", pollHeldSince: POLL_OWNER }, calls),
    );

    const result = await discover("ownership-deferred");

    // Neither pipeline discovers, and nothing closes the poll another run
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
