import { describe, expect, test } from "vitest";
import { WorkflowClient } from "@temporalio/client";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { MatchDeliveryMode } from "@scout-for-lol/domain/match-processing/states.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type {
  ScoutDiscoveredMatch,
  ScoutMatchObservationInput,
  ScoutPostMatchScanResult,
} from "#src/activity-contracts.ts";
import { SCOUT_MATCH_RECEIPT_KINDS } from "#src/match-receipts.ts";
import {
  scoutMatchProcessingInputCodec,
  scoutMatchProcessingResultCodec,
  scoutPostMatchDiscoveryInputCodec,
  scoutPostMatchDiscoveryResultCodec,
} from "#src/workflow-contracts.ts";
import { scoutMatchProcessingWorkflowId } from "#src/identifiers.ts";
import {
  scoutMatchProcessingWorkflow,
  scoutPostMatchDiscoveryWorkflow,
} from "./index.ts";
import {
  attested,
  attestedPipelineState,
  claimScoutPoll,
  closeScoutPoll,
  createScoutMatchStore,
  createScoutPollRow,
  scoutMatchActivityStubs,
  MATCH_ID,
  type ScoutMatchStore,
} from "./match.test-fixtures.ts";
import {
  applicationFailureOf,
  settleWorkflow,
  useScoutWorkflowHarness,
} from "./workflow-harness.test-fixtures.ts";

const harness = useScoutWorkflowHarness();

const stage = "dev" as const;
const SECOND_MATCH_ID = RiotMatchIdSchema.parse("NA1_9002");
// The poll a scan claimed, by the instant it was claimed at. Maintenance
// closes exactly this poll, so it travels from the scan to the close.
const POLL_OWNER = IsoInstantSchema.parse("2026-09-13T07:59:00.000Z");
const SOURCE_PUUID = LeaguePuuidSchema.parse("s".repeat(78));

/** One discovered match, as the scan reports it: the id and who surfaced it. */
function discovered(
  riotMatchId: RiotMatchId,
  deliveryMode: MatchDeliveryMode = "live",
  gameEndTimestamp?: number,
): ScoutDiscoveredMatch {
  return {
    riotMatchId,
    sourcePuuid: SOURCE_PUUID,
    deliveryMode,
    ...(gameEndTimestamp === undefined ? {} : { gameEndTimestamp }),
  };
}
const SERIAL_CORE = [
  "readMatchPipelineState",
  "archiveMatchArtifacts",
  "commitMatchObservation",
  "settleMatchMarkets",
  "applyMatchProgression",
  "finalizeTournamentResult",
  "recordMatchReceipts",
  "mintPostmatchNotificationIntents",
  "advanceMatchCursor",
  "planMatchFanOut",
];

async function processMatch(
  workflowId: string,
  riotMatchId = MATCH_ID,
): Promise<unknown> {
  return await harness.client().workflow.execute(scoutMatchProcessingWorkflow, {
    taskQueue: "scout-dev",
    workflowId,
    args: [scoutMatchProcessingInputCodec.serialize({ stage, riotMatchId })],
  });
}

async function discover(workflowId: string): Promise<unknown> {
  const handle = await startDiscovery(workflowId);
  return await handle.result();
}

function startDiscovery(
  workflowId: string,
  client: WorkflowClient = harness.client().workflow,
) {
  return client.start(scoutPostMatchDiscoveryWorkflow, {
    taskQueue: "scout-dev",
    workflowId,
    args: [
      scoutPostMatchDiscoveryInputCodec.serialize({
        stage,
        trigger: "schedule",
      }),
    ],
  });
}

/** A scan of one live match, with the claim maintenance closes it by. */
function scanOf(
  ...matches: readonly ScoutDiscoveredMatch[]
): ScoutPostMatchScanResult {
  return {
    outcome: "scanned",
    riotMatchIds: matches.map((match) => match.riotMatchId),
    matches,
    complete: true,
    pollOwner: POLL_OWNER,
  };
}

describe("the V2 per-match core", () => {
  test("runs the serial core in order and attests to every phase", async () => {
    const store = createScoutMatchStore();
    await harness.startWorkers(scoutMatchActivityStubs(store));

    const result = await processMatch("match-core-happy");

    // Started without a discovering account — the reconciliation shape — the
    // run commits its observation with no source to check, explicitly.
    expect(store.observationSources).toEqual([undefined]);

    expect(store.calls).toEqual(SERIAL_CORE);
    expect(result).toEqual(
      scoutMatchProcessingResultCodec.serialize({
        status: "completed",
        riotMatchId: MATCH_ID,
        owner: { kind: "temporal-v2" },
        policy: "FULL",
        deliveryMode: "live",
        receiptKinds: [
          SCOUT_MATCH_RECEIPT_KINDS.archive,
          SCOUT_MATCH_RECEIPT_KINDS.observation,
          SCOUT_MATCH_RECEIPT_KINDS.settlement,
          SCOUT_MATCH_RECEIPT_KINDS.progression,
          SCOUT_MATCH_RECEIPT_KINDS.tournament,
        ],
        // Both child types have bodies now, so the plan this run computed is
        // started rather than merely counted. The children are abandoned by
        // design — a notification outlives the match run that promised it — so
        // nothing here waits on them, and their own Activities are not
        // registered on this test's workers; the plan's content is asserted in
        // `match-fan-out-v2.test.ts`.
        childrenStarted: { notifications: 1, lakeProjections: 1 },
      }),
    );
    expect(store.applied).toEqual(["settlement", "progression", "cursor"]);
  }, 60_000);

  test("mints the report before the cursor moves, and fails the run if it cannot", async () => {
    // The cursor is what stops the match being rediscovered, so it must move
    // last. A mint that failed after it would leave the match settled, its
    // receipts standing, no association unadvanced and no intent row — so
    // reconciliation reads it as finished, the notification scan has nothing
    // to recover, and the report is lost with no trace of the loss.
    const store = createScoutMatchStore({
      failAt: "mintPostmatchNotificationIntents",
    });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    await expect(
      processMatch("match-core-mint-before-cursor"),
    ).rejects.toThrow();

    // The run failed, and crucially the cursor never moved: the next discovery
    // surfaces this match again.
    expect(store.calls).not.toContain("advanceMatchCursor");
    expect(store.cursorAdvanced).toBe(0);
    expect(store.applied).not.toContain("cursor");
  }, 60_000);

  test("fans out only after the domain commit and the cursor advance", async () => {
    const store = createScoutMatchStore();
    await harness.startWorkers(scoutMatchActivityStubs(store));
    await processMatch("match-core-ordering");

    // A notification is a promise about a fact. Planning it before the
    // settlement commit or before the cursor moved would let a child deliver a
    // claim the pipeline had not yet made durable.
    const planned = store.calls.indexOf("planMatchFanOut");
    for (const earlier of [
      "settleMatchMarkets",
      "recordMatchReceipts",
      "advanceMatchCursor",
    ]) {
      expect(store.calls.indexOf(earlier)).toBeLessThan(planned);
    }
  }, 60_000);

  test.each([
    {
      name: "the archive",
      store: () => attested("archive"),
      skipped: ["archiveMatchArtifacts"],
      applied: ["settlement", "progression", "cursor"],
    },
    {
      name: "the observation",
      store: () => attested("archive", "observation"),
      skipped: ["archiveMatchArtifacts", "commitMatchObservation"],
      applied: ["settlement", "progression", "cursor"],
    },
    {
      name: "the settlement",
      store: () => attested("archive", "observation", "settlement"),
      skipped: [
        "archiveMatchArtifacts",
        "commitMatchObservation",
        "settleMatchMarkets",
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
        "archiveMatchArtifacts",
        "commitMatchObservation",
        "settleMatchMarkets",
        "applyMatchProgression",
        "finalizeTournamentResult",
        // Nothing new was attested, so there is nothing to record.
        "recordMatchReceipts",
      ],
      applied: ["cursor"],
    },
  ])(
    "resumes past $name once its receipt stands",
    async (scenario) => {
      const store = scenario.store();
      await harness.startWorkers(scoutMatchActivityStubs(store));

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
    const store = createScoutMatchStore({ owner: { kind: "legacy-v1" } });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    const result = await processMatch("match-core-foreign-owner");

    expect(store.calls).toEqual([
      "readMatchPipelineState",
      "archiveMatchArtifacts",
      "commitMatchObservation",
      "recordMatchReceipts",
    ]);
    expect(store.applied).toEqual([]);
    expect(result).toMatchObject({
      data: { status: "no-op", owner: { kind: "legacy-v1" } },
    });
  }, 60_000);

  test("skips the downstream effects for an ARCHIVE_ONLY match", async () => {
    const store = createScoutMatchStore({ policy: "ARCHIVE_ONLY" });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    await processMatch("match-core-archive-only");

    expect(store.calls).not.toContain("settleMatchMarkets");
    expect(store.calls).not.toContain("applyMatchProgression");
    expect(store.applied).toEqual(["cursor"]);
  }, 60_000);
});

describe("the delivery mode a run operates under", () => {
  test("a restart with no mode of its own reports the committed one", async () => {
    // The reconciliation restart: no discovery pass behind it, so no mode in
    // its input. It must take what the observation already recorded, because
    // deciding afresh is exactly how a silent backfill comes to announce
    // itself on a restart nobody meant as a live discovery.
    const store = createScoutMatchStore({
      deliveryMode: "silent-backfill",
      observed: true,
      receiptKinds: [
        SCOUT_MATCH_RECEIPT_KINDS.archive,
        SCOUT_MATCH_RECEIPT_KINDS.observation,
      ],
    });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    const result = await processMatch("match-core-restart-delivery-mode");

    // The resume point answered; the commit was not re-run for it.
    expect(store.observationDeliveryModes).toEqual([]);
    expect(result).toMatchObject({
      data: { deliveryMode: "silent-backfill" },
    });
  }, 60_000);

  test("a run that commits the observation reports the mode it committed", async () => {
    const store = createScoutMatchStore({ deliveryMode: "silent-backfill" });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    const result = await processMatch("match-core-commit-delivery-mode");

    expect(result).toMatchObject({
      data: { deliveryMode: "silent-backfill" },
    });
  }, 60_000);
});

describe("a contested archive attestation", () => {
  test("fails the run before the observation, the receipts or the cursor", async () => {
    // A conflicting receipt means one already stands for this artifact
    // identity carrying different evidence. Building on it would derive the
    // observation's artifact identity from a claim this run never agreed with
    // and then advance the cursor past the match, so nothing would look at it
    // again.
    const store = createScoutMatchStore({ archiveConflictsOnce: true });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    await expect(processMatch("match-archive-conflict")).rejects.toThrow();

    expect(store.calls).toEqual([
      "readMatchPipelineState",
      "archiveMatchArtifacts",
    ]);
    expect(store.calls).not.toContain("commitMatchObservation");
    expect(store.calls).not.toContain("recordMatchReceipts");
    expect(store.calls).not.toContain("advanceMatchCursor");
    expect(store.applied).toEqual([]);
    expect(store.receiptKinds).toEqual([]);
    expect(store.observed).toBe(false);
  }, 60_000);

  test("fails the run when a stage receipt is contested", async () => {
    // The evidence a V2 stage receipt carries is derived from the match
    // reference and the phase alone, so two runs can only disagree about it if
    // something is producing evidence no rule here can produce. Advancing the
    // cursor over that would let the NEXT execution skip the phase on the
    // strength of a receipt this run never agreed with.
    const store = createScoutMatchStore({ receiptsConflict: true });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    await expect(processMatch("match-receipt-conflict")).rejects.toThrow();

    expect(store.calls).toContain("recordMatchReceipts");
    expect(store.calls).not.toContain("advanceMatchCursor");
    expect(store.calls).not.toContain("planMatchFanOut");
  }, 60_000);

  test("stays failed on the next execution instead of advancing past the drift", async () => {
    // The failed run is not durable: under ALLOW_DUPLICATE_FAILED_ONLY the
    // next discovery starts a fresh execution, whose resume read sees the
    // contested kinds standing WITHOUT the outcome that contested them. What
    // keeps it from skipping the phases and advancing the cursor over the
    // same disagreement is the marker the Activity recorded — which the
    // resume read surfaces and the Workflow refuses at, before any phase.
    const store = createScoutMatchStore({ receiptsConflict: true });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    await expect(
      processMatch("match-receipt-conflict-first"),
    ).rejects.toThrow();
    const callsAfterFirst = store.calls.length;

    const failure = applicationFailureOf(
      await settleWorkflow(processMatch("match-receipt-conflict-retry")),
    );
    expect(failure?.type).toBe("DurableCommitConflict");
    expect(failure?.nonRetryable).toBe(true);
    expect(failure?.message).toMatch(/contested/);

    expect(store.calls.slice(callsAfterFirst)).toEqual([
      "readMatchPipelineState",
    ]);
    expect(store.calls).not.toContain("advanceMatchCursor");
    expect(store.applied).toEqual(["settlement", "progression"]);
  }, 90_000);

  test("converges on the next attempt through the archive read gate", async () => {
    // A rival attested different bytes under this artifact's identity. The
    // first attempt fails loudly; the next reads the standing receipt, reports
    // the match as already archived, and the pipeline proceeds on the
    // attested artifact rather than on the one it never agreed with.
    const store = createScoutMatchStore({ archiveConflictsOnce: true });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    await expect(processMatch("match-archive-race")).rejects.toThrow();
    const result = await processMatch("match-archive-race-retry");

    expect(result).toMatchObject({ data: { status: "completed" } });
    expect(store.applied).toEqual(["settlement", "progression", "cursor"]);
  }, 90_000);
});

describe("the V2 tournament finalization stage", () => {
  test("finalizes a managed custom game before the cursor advances", async () => {
    // v1 finalizes at exactly this point and is the only caller repo-wide.
    // Advancing the cursor first would leave the result unreported and the
    // Custom Night snapshot unpublished, with nothing left to rediscover the
    // match and fix it.
    const store = createScoutMatchStore({ tournamentMatch: true });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    await processMatch("match-tournament-finalized");

    expect(store.calls.indexOf("finalizeTournamentResult")).toBeLessThan(
      store.calls.indexOf("advanceMatchCursor"),
    );
    expect(store.applied).toEqual([
      "settlement",
      "progression",
      "tournament",
      "cursor",
    ]);
  }, 60_000);

  test("runs the stage for an ordinary match and finalizes nothing", async () => {
    const store = createScoutMatchStore();
    await harness.startWorkers(scoutMatchActivityStubs(store));

    await processMatch("match-tournament-ordinary");

    // The stage still runs — nothing else can know whether a lobby exists —
    // but it applies no effect.
    expect(store.calls).toContain("finalizeTournamentResult");
    expect(store.applied).toEqual(["settlement", "progression", "cursor"]);
  }, 60_000);

  test("resumes after a crash between finalization and the cursor without finalizing twice", async () => {
    const store = createScoutMatchStore({
      tournamentMatch: true,
      failAt: "recordMatchReceipts",
    });
    await harness.startWorkers(scoutMatchActivityStubs(store));

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
    { name: "the S3 archive", failAt: "commitMatchObservation" },
    { name: "the domain commit", failAt: "recordMatchReceipts" },
    { name: "the cursor advance", failAt: "planMatchFanOut" },
  ])(
    "applies each effect exactly once across $name",
    async (scenario) => {
      const store = createScoutMatchStore({ failAt: scenario.failAt });
      await harness.startWorkers(scoutMatchActivityStubs(store));

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
    const store = createScoutMatchStore({ failAt: "settleMatchMarkets" });
    await harness.startWorkers(scoutMatchActivityStubs(store));

    await expect(processMatch("match-settle-conflict")).rejects.toThrow();

    expect(store.calls).not.toContain("recordMatchReceipts");
    expect(store.calls).not.toContain("advanceMatchCursor");
    expect(store.calls).not.toContain("planMatchFanOut");
    expect(store.applied).toEqual([]);
    expect(store.receiptKinds).toEqual([]);
  }, 60_000);
});

describe("a per-match history recorded before deliveryMode existed", () => {
  // The two recorded Activity results that gained the field. Each is the
  // Workflow's ONLY source for it on its path, and the value is spread into a
  // codec that requires it — so a run replaying either from before the change
  // fails its Workflow task forever rather than failing the execution.

  test("resumes from a pre-change pipeline state", async () => {
    // The resumable path: an observation receipt already stands, so the state
    // this run read at its resume point is where the mode comes from.
    const store = createScoutMatchStore();
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      readMatchPipelineState: (input: { riotMatchId: string }) => {
        const present = attestedPipelineState(
          RiotMatchIdSchema.parse(input.riotMatchId),
          "archive",
          "observation",
        );
        if (present.kind !== "present") return present;
        const { deliveryMode: _dropped, ...legacy } = present.state;
        return { kind: "present", state: legacy };
      },
    });

    const result = await processMatch("match-legacy-resume-state");

    expect(result).toMatchObject({
      data: { status: "completed", deliveryMode: "live" },
    });
    // And it genuinely resumed: the observation was not committed again.
    expect(store.calls).not.toContain("commitMatchObservation");
  }, 90_000);

  test("commits against a pre-change observation result", async () => {
    // The other path: nothing stands yet, so the commit's own read-back is
    // where the mode comes from.
    const store = createScoutMatchStore();
    const stubs = scoutMatchActivityStubs(store);
    await harness.startWorkers({
      ...stubs,
      commitMatchObservation: (input: ScoutMatchObservationInput) => {
        const { deliveryMode: _dropped, ...legacy } =
          stubs.commitMatchObservation(input);
        return legacy;
      },
    });

    const result = await processMatch("match-legacy-observation-result");

    expect(result).toMatchObject({
      data: { status: "completed", deliveryMode: "live" },
    });
    expect(store.calls).toContain("commitMatchObservation");
  }, 90_000);
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
    await harness.startWorkers({
      discoverPostMatchIds: () => ({
        outcome: "scanned",
        riotMatchIds: [MATCH_ID, SECOND_MATCH_ID],
        matches: [discovered(MATCH_ID), discovered(SECOND_MATCH_ID)],
        complete: true,
        pollOwner: POLL_OWNER,
      }),
      readMatchPipelineState: async (input: { riotMatchId: string }) => {
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
      advanceMatchCursor: async (input: { riotMatchId: string }) => {
        await trace("cursor")(input);
        return { advanced: 0, alreadyAdvanced: 2 };
      },
      mintPostmatchNotificationIntents: () => ({
        minted: 1,
        existing: 0,
        conflicts: 0,
        silent: 0,
      }),
      runPostMatchMaintenance: () => {
        log.push("maintenance");
      },
      planMatchFanOut: async (input: { riotMatchId: string }) => {
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
      // Maintenance closes the poll, and it closes it LAST.
      "maintenance",
    ]);
    expect(result).toEqual(
      scoutPostMatchDiscoveryResultCodec.serialize({
        status: "completed",
        discovered: 2,
        childrenStarted: 2,
        complete: true,
      }),
    );
  }, 90_000);

  test("closes the poll with maintenance on the success path", async () => {
    const store = createScoutMatchStore();
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      discoverPostMatchIds: () => ({
        outcome: "scanned",
        riotMatchIds: [MATCH_ID],
        matches: [discovered(MATCH_ID)],
        complete: true,
        pollOwner: POLL_OWNER,
        evidenceWatermark: "2026-09-13T08:00:00.000Z",
      }),
    });

    await discover("post-match-discovery-maintenance");

    // v1's flags, preserved: the whole tail was seen and processed, so Dare
    // deadlines may settle, and the watermark the scan computed travels with
    // them because nothing downstream can recover it.
    expect(store.maintenance).toEqual([
      {
        stage,
        settleDareV2Deadlines: true,
        // The close names the poll the scan opened, so it cannot land on a
        // poll some later run claimed after this one started.
        pollOwner: POLL_OWNER,
        evidenceWatermark: "2026-09-13T08:00:00.000Z",
      },
    ]);
  }, 90_000);

  test("still closes the poll when it stops early, without settling deadlines", async () => {
    // `BotState.pollStatus` is what the next poll reads to decide whether one
    // is already in flight, so a run that stopped early must still close it —
    // but it saw an unprocessed tail, so it may not settle Dare deadlines.
    const store = createScoutMatchStore();
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      discoverPostMatchIds: () => scanOf(discovered(MATCH_ID)),
    });
    await processMatch(scoutMatchProcessingWorkflowId(stage, MATCH_ID));

    await expect(
      discover("post-match-discovery-early-stop"),
    ).resolves.toMatchObject({ data: { complete: false } });

    expect(store.maintenance).toEqual([
      { stage, settleDareV2Deadlines: false, pollOwner: POLL_OWNER },
    ]);
  }, 90_000);

  test("resumes into maintenance without re-discovering", async () => {
    // The crash window between the children and maintenance: the discovery
    // result is already in history, so the retry resumes at the maintenance
    // call rather than polling Riot again.
    let discoveries = 0;
    const store = createScoutMatchStore({ maintenanceFailures: 1 });
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      discoverPostMatchIds: () => {
        discoveries += 1;
        return {
          outcome: "scanned",
          riotMatchIds: [],
          matches: [],
          complete: true,
          pollOwner: POLL_OWNER,
        };
      },
    });

    await discover("post-match-discovery-resume");

    expect(discoveries).toBe(1);
    expect(store.maintenance).toHaveLength(2);
  }, 90_000);

  test("keeps the poll claim a result recorded before `matches` existed", async () => {
    // The generation immediately before this one: it recorded `pollOwner`
    // but no `matches`. Reading the page off a single "is this the newest
    // shape" flag put those histories on the legacy branch and dropped the
    // claim from their close, taking the ownership guard off a poll that
    // HAD one — so maintenance could mark a newer run's poll complete.
    const store = createScoutMatchStore();
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      discoverPostMatchIds: () => ({
        outcome: "scanned",
        riotMatchIds: [MATCH_ID],
        complete: true,
        pollOwner: POLL_OWNER,
      }),
    });

    await discover("post-match-discovery-pre-matches");

    expect(store.maintenance).toEqual([
      { stage, settleDareV2Deadlines: true, pollOwner: POLL_OWNER },
    ]);
    // And the child is started with the arguments that generation sent: the
    // id alone. The mode is resolved inside the observation commit, which the
    // backend's own integration test pins.
    expect(store.observationDeliveryModes).toEqual([undefined]);
  }, 90_000);

  test("drives a bare-ids result, closing a poll it has no claim for", async () => {
    // The oldest generation: `riotMatchIds` and nothing else. There is no
    // claim to forward, so the close is unguarded exactly as it was then —
    // and the run must still process its page rather than fail every replay.
    const store = createScoutMatchStore();
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      discoverPostMatchIds: () => ({
        outcome: "scanned",
        riotMatchIds: [MATCH_ID],
        complete: true,
      }),
    });

    await discover("post-match-discovery-bare-ids");

    expect(store.maintenance).toEqual([{ stage, settleDareV2Deadlines: true }]);
    // Neither field reaches the child, because neither was in the command
    // that generation recorded.
    expect(store.observationDeliveryModes).toEqual([undefined]);
    expect(store.observationSources).toEqual([undefined]);
  }, 90_000);
});

/**
 * Who owns the poll while a discovery run is in flight, and who may close it.
 */
describe("the V2 post-match poll's ownership", () => {
  test("holds the poll across the children it awaits, so an overlapping run is skipped", async () => {
    // The overlap the durable claim exists for. The scheduled run's discovery
    // Activity has RETURNED and the run is away awaiting a child, which is
    // where an operator-triggered discovery lands. Ownership has to span that
    // whole stretch: the second run must be told the poll is held, and the
    // first run's maintenance must close the poll IT opened. Before it, the
    // second run opened a poll of its own and the first run's maintenance
    // marked that newer poll complete underneath it.
    const row = createScoutPollRow();
    const store = createScoutMatchStore();
    const childReached = Promise.withResolvers<true>();
    const releaseChild = Promise.withResolvers<true>();
    const operatorClaim = Promise.withResolvers<"claimed" | "held">();
    let discoveryCount = 0;
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      discoverPostMatchIds: () => {
        const claim = claimScoutPoll(row);
        discoveryCount += 1;
        if (discoveryCount === 2) operatorClaim.resolve(claim.outcome);
        return claim.outcome === "held"
          ? { outcome: "skipped" }
          : {
              outcome: "scanned",
              riotMatchIds: [MATCH_ID],
              matches: [discovered(MATCH_ID)],
              complete: true,
              pollOwner: claim.pollOwner,
            };
      },
      readMatchPipelineState: async (input: { riotMatchId: string }) => {
        // The child the first run is awaiting when the second run starts.
        childReached.resolve(true);
        await releaseChild.promise;
        return attestedPipelineState(
          RiotMatchIdSchema.parse(input.riotMatchId),
          "archive",
          "observation",
          "settlement",
          "progression",
          "tournament",
        );
      },
      runPostMatchMaintenance: (input: {
        settleDareV2Deadlines: boolean;
        pollOwner?: string;
      }) => {
        store.maintenance.push(input);
        closeScoutPoll(row, input.pollOwner);
      },
    });

    // Concurrent result waits must not each unlock the test server's global
    // clock. Keep this overlap on real time while the child Activity is held.
    const client = new WorkflowClient({
      connection: harness.client().connection,
      namespace: harness.client().options.namespace,
    });
    const scheduled = await startDiscovery(
      "post-match-discovery-overlap-scheduled",
      client,
    );
    await childReached.promise;
    const operator = await startDiscovery(
      "post-match-discovery-overlap-operator",
      client,
    );
    const operatorOutcome = await operatorClaim.promise;
    releaseChild.resolve(true);
    const [scheduledResult, operatorResult] = await Promise.all([
      scheduled.result(),
      operator.result(),
    ]);

    // The operator run found the poll held, so it opened nothing and closed
    // nothing.
    expect(operatorOutcome).toBe("held");
    expect(operatorResult).toMatchObject({
      data: { status: "no-op", discovered: 0, childrenStarted: 0 },
    });
    expect(scheduledResult).toMatchObject({
      data: { status: "completed", discovered: 1, childrenStarted: 1 },
    });
    expect(row.claims).toBe(1);
    // Exactly one close, naming the poll the scheduled run claimed.
    expect(store.maintenance).toHaveLength(1);
    expect(row.closed).toEqual([row.closed[0]]);
    expect(store.maintenance[0]?.pollOwner).toBe(row.closed[0]);
  }, 90_000);

  test("withholds maintenance when discovery was skipped for a running poll", async () => {
    // An operator run overlapping the scheduled one: discovery refuses to open
    // a second poll. This run opened nothing, so it must close nothing —
    // maintenance would mark the OTHER execution's poll complete under it
    // while that poll is still live.
    const store = createScoutMatchStore();
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      discoverPostMatchIds: () => ({ outcome: "skipped" }),
    });

    await expect(
      discover("post-match-discovery-skipped"),
    ).resolves.toMatchObject({
      data: { status: "no-op", discovered: 0, childrenStarted: 0 },
    });

    expect(store.maintenance).toEqual([]);
    expect(store.calls).not.toContain("runPostMatchMaintenance");
  }, 60_000);
});

/** What a discovery run hands its children, and when it stops starting them. */
describe("the V2 post-match child handoff", () => {
  test("hands each child the account that surfaced its match", async () => {
    // v1's source precondition lives in the observation commit, and only the
    // discovery pass knows which tracked account's history surfaced the
    // match — so the id alone is not enough for the child to carry.
    const store = createScoutMatchStore();
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      discoverPostMatchIds: () => scanOf(discovered(MATCH_ID)),
    });

    await discover("post-match-discovery-source");

    expect(store.observationSources).toEqual([SOURCE_PUUID]);
  }, 90_000);

  test("hands each child the delivery mode its discovery decided", async () => {
    // Only the discovery pass knows whether it was following live history or
    // filling a gap, and v1 makes that call per discovered match. A child that
    // had to decide for itself would have nothing to decide from, and the
    // wrong answer is the one that announces a backfill publicly.
    const store = createScoutMatchStore({ deliveryMode: "silent-backfill" });
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      discoverPostMatchIds: () => ({
        outcome: "scanned",
        riotMatchIds: [MATCH_ID],
        matches: [discovered(MATCH_ID, "silent-backfill")],
        complete: true,
        pollOwner: POLL_OWNER,
      }),
    });

    await discover("post-match-discovery-delivery-mode");

    expect(store.observationDeliveryModes).toEqual(["silent-backfill"]);
  }, 90_000);

  test("stops at a match another execution already owns", async () => {
    const store: ScoutMatchStore = createScoutMatchStore();
    await harness.startWorkers({
      ...scoutMatchActivityStubs(store),
      discoverPostMatchIds: () => scanOf(discovered(MATCH_ID)),
    });
    // A completed execution owns this match's child ID, so `startChild` is
    // refused. Continuing past it would let a LATER match settle while this one
    // is still owned elsewhere, which is the chronology the serialization
    // exists to preserve.
    await processMatch(scoutMatchProcessingWorkflowId(stage, MATCH_ID));

    await expect(discover("post-match-discovery-owned")).resolves.toMatchObject(
      { data: { discovered: 1, childrenStarted: 0, complete: false } },
    );
  }, 90_000);
});
