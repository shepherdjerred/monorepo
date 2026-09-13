import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { SCOUT_V2_MATCH_RECEIPT_KINDS } from "#src/match-receipts-v2.ts";
import {
  scoutMatchProcessingV2InputCodec,
  scoutMatchProcessingV2ResultCodec,
  scoutPostMatchDiscoveryV2InputCodec,
  scoutPostMatchDiscoveryV2ResultCodec,
} from "#src/workflow-contracts-v2.ts";
import { scoutMatchProcessingV2WorkflowId } from "#src/identifiers.ts";
import {
  scoutMatchProcessingV2Workflow,
  scoutPostMatchDiscoveryV2Workflow,
} from "./index.ts";
import {
  attested,
  attestedPipelineState,
  createScoutV2MatchStore,
  scoutV2MatchActivityStubs,
  MATCH_ID,
  type ScoutV2MatchStore,
} from "./match-v2.test-fixtures.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

let environment: TestWorkflowEnvironment;
const workers = createScoutWorkerPool();

const stage = "dev" as const;
const SECOND_MATCH_ID = RiotMatchIdSchema.parse("NA1_9002");
const SERIAL_CORE = [
  "readMatchPipelineStateV2",
  "archiveMatchArtifactsV2",
  "commitMatchObservationV2",
  "settleMatchMarketsV2",
  "applyMatchProgressionV2",
  "finalizeTournamentResultV2",
  "recordMatchReceiptsV2",
  "advanceMatchCursorV2",
  "planMatchFanOutV2",
];

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  await workers.drain();
  await environment.teardown();
});

/**
 * One Workflow worker and one Activity worker. The SDK refuses a second worker
 * on a task queue already served in this process, so every scenario — including
 * a crash and its replay — runs against a single Activity registration whose
 * behaviour comes from the store it closes over.
 */
async function startWorkers(activities: object): Promise<void> {
  await workers.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev",
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      maxConcurrentWorkflowTaskExecutions: 4,
    }),
  );
  await workers.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev-realtime",
      activities,
      maxConcurrentActivityTaskExecutions: 4,
    }),
  );
}

async function processMatch(
  workflowId: string,
  riotMatchId = MATCH_ID,
): Promise<unknown> {
  return await environment.client.workflow.execute(
    scoutMatchProcessingV2Workflow,
    {
      taskQueue: "scout-dev",
      workflowId,
      args: [
        scoutMatchProcessingV2InputCodec.serialize({ stage, riotMatchId }),
      ],
    },
  );
}

async function discover(workflowId: string): Promise<unknown> {
  return await environment.client.workflow.execute(
    scoutPostMatchDiscoveryV2Workflow,
    {
      taskQueue: "scout-dev",
      workflowId,
      args: [
        scoutPostMatchDiscoveryV2InputCodec.serialize({
          stage,
          trigger: "schedule",
        }),
      ],
    },
  );
}

describe("the V2 per-match core", () => {
  test("runs the serial core in order and attests to every phase", async () => {
    const store = createScoutV2MatchStore();
    await startWorkers(scoutV2MatchActivityStubs(store));

    const result = await processMatch("match-core-happy");

    expect(store.calls).toEqual(SERIAL_CORE);
    expect(result).toEqual(
      scoutMatchProcessingV2ResultCodec.serialize({
        status: "completed",
        riotMatchId: MATCH_ID,
        owner: { kind: "temporal-v2" },
        policy: "FULL",
        receiptKinds: [
          SCOUT_V2_MATCH_RECEIPT_KINDS.archive,
          SCOUT_V2_MATCH_RECEIPT_KINDS.observation,
          SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
          SCOUT_V2_MATCH_RECEIPT_KINDS.progression,
          SCOUT_V2_MATCH_RECEIPT_KINDS.tournament,
        ],
        // The notification and lake children are registered contracts with no
        // implementation yet, so this run plans them and starts none. The
        // plan's own content is asserted in `match-fan-out-v2.test.ts`.
        childrenStarted: { notifications: 0, lakeProjections: 0 },
      }),
    );
    expect(store.applied).toEqual(["settlement", "progression", "cursor"]);
  }, 60_000);

  test("fans out only after the domain commit and the cursor advance", async () => {
    const store = createScoutV2MatchStore();
    await startWorkers(scoutV2MatchActivityStubs(store));
    await processMatch("match-core-ordering");

    // A notification is a promise about a fact. Planning it before the
    // settlement commit or before the cursor moved would let a child deliver a
    // claim the pipeline had not yet made durable.
    const planned = store.calls.indexOf("planMatchFanOutV2");
    for (const earlier of [
      "settleMatchMarketsV2",
      "recordMatchReceiptsV2",
      "advanceMatchCursorV2",
    ]) {
      expect(store.calls.indexOf(earlier)).toBeLessThan(planned);
    }
  }, 60_000);

  test.each([
    {
      name: "the archive",
      store: () => attested("archive"),
      skipped: ["archiveMatchArtifactsV2"],
      applied: ["settlement", "progression", "cursor"],
    },
    {
      name: "the observation",
      store: () => attested("archive", "observation"),
      skipped: ["archiveMatchArtifactsV2", "commitMatchObservationV2"],
      applied: ["settlement", "progression", "cursor"],
    },
    {
      name: "the settlement",
      store: () => attested("archive", "observation", "settlement"),
      skipped: [
        "archiveMatchArtifactsV2",
        "commitMatchObservationV2",
        "settleMatchMarketsV2",
      ],
      applied: ["progression", "cursor"],
    },
    {
      name: "every phase",
      store: () =>
        attested(
          "archive",
          "observation",
          "settlement",
          "progression",
          "tournament",
        ),
      skipped: [
        "archiveMatchArtifactsV2",
        "commitMatchObservationV2",
        "settleMatchMarketsV2",
        "applyMatchProgressionV2",
        "finalizeTournamentResultV2",
        // Nothing new was attested, so there is nothing to record.
        "recordMatchReceiptsV2",
      ],
      applied: ["cursor"],
    },
  ])(
    "resumes past $name once its receipt stands",
    async (scenario) => {
      const store = scenario.store();
      await startWorkers(scoutV2MatchActivityStubs(store));

      const result = await processMatch(
        `match-core-resume-${String(store.receiptKinds.length)}`,
      );

      expect(store.calls).toEqual(
        SERIAL_CORE.filter((call) => !scenario.skipped.includes(call)),
      );
      // A resumed run re-applies only what no receipt gates yet. The cursor is
      // always in that set: the association rows carry it per account, so it has
      // a better durable signal than a match-wide receipt could give it.
      expect(store.applied).toEqual(scenario.applied);
      expect(result).toMatchObject({ data: { status: "completed" } });
    },
    60_000,
  );

  test("stops before the effects when another pipeline owns the match", async () => {
    const store = createScoutV2MatchStore({ owner: { kind: "legacy-v1" } });
    await startWorkers(scoutV2MatchActivityStubs(store));

    const result = await processMatch("match-core-foreign-owner");

    expect(store.calls).toEqual([
      "readMatchPipelineStateV2",
      "archiveMatchArtifactsV2",
      "commitMatchObservationV2",
      "recordMatchReceiptsV2",
    ]);
    expect(store.applied).toEqual([]);
    expect(result).toMatchObject({
      data: { status: "no-op", owner: { kind: "legacy-v1" } },
    });
  }, 60_000);

  test("skips the downstream effects for an ARCHIVE_ONLY match", async () => {
    const store = createScoutV2MatchStore({ policy: "ARCHIVE_ONLY" });
    await startWorkers(scoutV2MatchActivityStubs(store));

    await processMatch("match-core-archive-only");

    expect(store.calls).not.toContain("settleMatchMarketsV2");
    expect(store.calls).not.toContain("applyMatchProgressionV2");
    expect(store.applied).toEqual(["cursor"]);
  }, 60_000);
});

describe("the V2 tournament finalization stage", () => {
  test("finalizes a tournament-code custom game before the cursor advances", async () => {
    // v1 finalizes at exactly this point and is the only caller repo-wide.
    // Advancing the cursor first would leave the result unreported and the
    // Custom Night snapshot unpublished, with nothing left to rediscover the
    // match and fix it.
    const store = createScoutV2MatchStore({ tournamentMatch: true });
    await startWorkers(scoutV2MatchActivityStubs(store));

    await processMatch("match-tournament-finalized");

    expect(store.calls.indexOf("finalizeTournamentResultV2")).toBeLessThan(
      store.calls.indexOf("advanceMatchCursorV2"),
    );
    expect(store.applied).toEqual([
      "settlement",
      "progression",
      "tournament",
      "cursor",
    ]);
  }, 60_000);

  test("runs the stage for an ordinary match and finalizes nothing", async () => {
    const store = createScoutV2MatchStore();
    await startWorkers(scoutV2MatchActivityStubs(store));

    await processMatch("match-tournament-ordinary");

    // The stage still runs — nothing else can know whether a lobby exists —
    // but it applies no effect.
    expect(store.calls).toContain("finalizeTournamentResultV2");
    expect(store.applied).toEqual(["settlement", "progression", "cursor"]);
  }, 60_000);

  test("resumes after a crash between finalization and the cursor without finalizing twice", async () => {
    const store = createScoutV2MatchStore({
      tournamentMatch: true,
      failAt: "recordMatchReceiptsV2",
    });
    await startWorkers(scoutV2MatchActivityStubs(store));

    await expect(processMatch("match-tournament-crash")).rejects.toThrow();
    store.failAt = null;
    await processMatch("match-tournament-replay");

    // The replacement run re-enters the stage — the crash lost the receipt
    // that would have skipped it — and the stage's own idempotency is what
    // keeps the finalization from happening twice.
    expect(store.applied).toEqual([
      "settlement",
      "progression",
      "tournament",
      "cursor",
    ]);
    expect(new Set(store.applied).size).toBe(store.applied.length);
  }, 90_000);
});

describe("a V2 per-match run killed mid-pipeline", () => {
  test.each([
    { name: "the S3 archive", failAt: "commitMatchObservationV2" },
    { name: "the domain commit", failAt: "recordMatchReceiptsV2" },
    { name: "the cursor advance", failAt: "planMatchFanOutV2" },
  ])(
    "applies each effect exactly once across $name",
    async (scenario) => {
      const store = createScoutV2MatchStore({ failAt: scenario.failAt });
      await startWorkers(scoutV2MatchActivityStubs(store));

      await expect(
        processMatch(`match-crash-${scenario.failAt}`),
      ).rejects.toThrow();

      // The replacement run resolves every phase from the durable state the dead
      // one left, which is what a replay actually is.
      store.failAt = null;
      await processMatch(`match-replay-${scenario.failAt}`);

      // The multiset, not the count: it states both which effects happened and
      // that none happened twice. The guarded effects reconcile through their
      // claims even when the crash lost the receipt that would have skipped them.
      expect(store.applied).toEqual(["settlement", "progression", "cursor"]);
      expect(new Set(store.applied).size).toBe(store.applied.length);
    },
    90_000,
  );

  test("a failed guarded effect stops the run before the receipts and the cursor", async () => {
    // What a `conflict` fact does at the Activity boundary: the fence refuses
    // to complete the claim and fails the Activity, so the run must not go on
    // to attest to the phase or move the cursor — either would bury the drift
    // behind a resume point that says the work is done.
    const store = createScoutV2MatchStore({ failAt: "settleMatchMarketsV2" });
    await startWorkers(scoutV2MatchActivityStubs(store));

    await expect(processMatch("match-settle-conflict")).rejects.toThrow();

    expect(store.calls).not.toContain("recordMatchReceiptsV2");
    expect(store.calls).not.toContain("advanceMatchCursorV2");
    expect(store.calls).not.toContain("planMatchFanOutV2");
    expect(store.applied).toEqual([]);
    expect(store.receiptKinds).toEqual([]);
  }, 60_000);
});

describe("V2 post-match discovery", () => {
  test("processes discovered matches one at a time, in discovery order", async () => {
    const log: string[] = [];
    const trace =
      (phase: string, delayMs = 0) =>
      async (input: { riotMatchId: string }) => {
        log.push(`${input.riotMatchId}:${phase}`);
        if (delayMs > 0) await new Promise((done) => setTimeout(done, delayMs));
      };
    await startWorkers({
      discoverPostMatchIdsV2: () => ({
        riotMatchIds: [MATCH_ID, SECOND_MATCH_ID],
        complete: true,
      }),
      readMatchPipelineStateV2: async (input: { riotMatchId: string }) => {
        // The first match is slow on purpose: a second child that started
        // concurrently would interleave its calls into the log below.
        await trace("read", input.riotMatchId === MATCH_ID ? 50 : 0)(input);
        return attestedPipelineState(
          RiotMatchIdSchema.parse(input.riotMatchId),
          "archive",
          "observation",
          "settlement",
          "progression",
          "tournament",
        );
      },
      advanceMatchCursorV2: async (input: { riotMatchId: string }) => {
        await trace("cursor")(input);
        return { advanced: 0, alreadyAdvanced: 2 };
      },
      planMatchFanOutV2: async (input: { riotMatchId: string }) => {
        await trace("fan-out")(input);
        return { notificationIntentKeys: [], lakeProjection: false };
      },
    });

    const result = await discover("post-match-discovery-serial");

    // Bounded Dare plans are ordered by match end time, so a later match must
    // not reach settlement while an earlier one is still being processed.
    expect(log).toEqual([
      `${MATCH_ID}:read`,
      `${MATCH_ID}:cursor`,
      `${MATCH_ID}:fan-out`,
      `${SECOND_MATCH_ID}:read`,
      `${SECOND_MATCH_ID}:cursor`,
      `${SECOND_MATCH_ID}:fan-out`,
    ]);
    expect(result).toEqual(
      scoutPostMatchDiscoveryV2ResultCodec.serialize({
        status: "completed",
        discovered: 2,
        childrenStarted: 2,
        complete: true,
      }),
    );
  }, 90_000);

  test("stops at a match another execution already owns", async () => {
    const store: ScoutV2MatchStore = createScoutV2MatchStore();
    await startWorkers({
      ...scoutV2MatchActivityStubs(store),
      discoverPostMatchIdsV2: () => ({
        riotMatchIds: [MATCH_ID],
        complete: true,
      }),
    });
    // A completed execution owns this match's child ID, so `startChild` is
    // refused. Continuing past it would let a LATER match settle while this one
    // is still owned elsewhere, which is the chronology the serialization
    // exists to preserve.
    await processMatch(scoutMatchProcessingV2WorkflowId(stage, MATCH_ID));

    await expect(discover("post-match-discovery-owned")).resolves.toMatchObject(
      { data: { discovered: 1, childrenStarted: 0, complete: false } },
    );
  }, 90_000);
});
