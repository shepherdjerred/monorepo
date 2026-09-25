import { ApplicationFailure } from "@temporalio/common";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type {
  MatchDeliveryMode,
  MatchProcessingPolicy,
  PipelineOwner,
  ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import {
  ArtifactDescriptorSchema,
  type ArtifactDescriptor,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { ReceiptKindSchema } from "@scout-for-lol/domain/match-processing/states.ts";
import type {
  ScoutArchiveV2Result,
  ScoutFanOutV2Result,
  ScoutGuardedEffectV2Result,
  ScoutMatchCursorV2Result,
  ScoutMatchObservationV2Input,
  ScoutMatchObservationV2Result,
  ScoutMatchPipelineStateV2Result,
  ScoutMatchReceiptsV2Input,
  ScoutMintedIntentsV2Result,
  ScoutReceiptsV2Result,
  ScoutTournamentResultV2Result,
} from "#src/activity-contracts-v2.ts";
import {
  ScoutNotificationIntentKeySchema,
  type ScoutDurableCommitV2,
} from "#src/contracts-v2.ts";
import {
  SCOUT_V2_MATCH_RECEIPT_KINDS,
  SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
  type ScoutV2MatchPhase,
} from "#src/match-receipts-v2.ts";

export const MATCH_ID: RiotMatchId = RiotMatchIdSchema.parse("NA1_9001");
const RAW_ARCHIVE_MATCH = ReceiptKindSchema.parse("raw-archive-match");
const MATCH_ARTIFACT: ArtifactDescriptor = ArtifactDescriptorSchema.parse({
  kind: "match",
  key: "games/2026/09/13/NA1_9001/match.json",
  digest: "a".repeat(64),
  bytes: 4096,
  contentType: "application/json",
  capturedAt: "2026-09-13T10:00:00.000Z",
});

export const INTENT_KEY = ScoutNotificationIntentKeySchema.parse(
  "postmatch-discord:NA1_9001:100000000000000001",
);

/**
 * A durable store the V2 per-match Activities can be replayed against.
 *
 * These tests are about what survives a crash, so the fake keeps exactly the
 * two things the real system keeps: the receipts that tell a resumed run which
 * phases already happened, and the effect claims that stop a guarded effect
 * being applied twice when its receipt was lost. Riot, S3 and the ledger are
 * irrelevant to that question and are not modelled.
 *
 * {@link ScoutV2MatchStore.applied} is the assertion surface — one entry per
 * effect the store actually APPLIED, as opposed to the calls it received.
 * Comparing its contents across two runs is what tells "the Activity ran again
 * and reconciled" apart from "the effect happened twice".
 */
export type ScoutV2MatchStore = {
  observed: boolean;
  owner: PipelineOwner;
  policy: MatchProcessingPolicy;
  receiptKinds: ReceiptKind[];
  trackedAccounts: number;
  cursorAdvanced: number;
  applied: string[];
  calls: string[];
  completedClaims: Set<string>;
  /** Whether this match belongs to a managed custom game. */
  tournamentMatch: boolean;
  /** The committed delivery mode the resume point and the commit report. */
  deliveryMode: MatchDeliveryMode;
  /**
   * Whether the FIRST archive attempt meets a receipt already standing for
   * the same artifact identity with different evidence — the overlapping-
   * attempt race. Later attempts read-gate on that standing receipt and
   * report the match as already archived, which is how the race self-heals.
   */
  archiveConflictsOnce: boolean;
  archiveConflicted: boolean;
  /** The `sourcePuuid` each observation commit was handed, in call order. */
  observationSources: (string | undefined)[];
  /** The `deliveryMode` each observation commit was handed, in call order. */
  observationDeliveryModes: (MatchDeliveryMode | undefined)[];
  /** Every post-match maintenance call, with the flags v1 gives it. */
  maintenance: {
    settleDareV2Deadlines: boolean;
    evidenceWatermark?: string;
    /** Which poll the call may close, when discovery claimed one. */
    pollOwner?: string;
  }[];
  /** Whether stage receipts come back contested by a standing receipt. */
  receiptsConflict: boolean;
  /** How many maintenance attempts should fail before one succeeds. */
  maintenanceFailures: number;
  /**
   * The call the worker dies ON, which models a crash right AFTER the
   * preceding phase committed. Mutable so one worker can serve both the run
   * that dies and the run that replaces it: the SDK refuses two workers on one
   * task queue in a process, and a replay is about the durable state the dead
   * run left, not about which process reads it.
   */
  failAt: string | null;
};

export function createScoutV2MatchStore(
  overrides: Partial<ScoutV2MatchStore> = {},
): ScoutV2MatchStore {
  return {
    observed: false,
    owner: { kind: "temporal-v2" },
    policy: "FULL",
    receiptKinds: [],
    trackedAccounts: 2,
    cursorAdvanced: 0,
    applied: [],
    calls: [],
    completedClaims: new Set<string>(),
    tournamentMatch: false,
    deliveryMode: "live",
    archiveConflictsOnce: false,
    archiveConflicted: false,
    observationSources: [],
    observationDeliveryModes: [],
    maintenance: [],
    maintenanceFailures: 0,
    receiptsConflict: false,
    failAt: null,
    ...overrides,
  };
}

/** Leave the store as a prior run that attested to these phases would have. */
export function attested(
  ...phases: readonly ScoutV2MatchPhase[]
): ScoutV2MatchStore {
  return createScoutV2MatchStore({
    observed: true,
    receiptKinds: phases.map((phase) => SCOUT_V2_MATCH_RECEIPT_KINDS[phase]),
  });
}

function guardedEffect(
  store: ScoutV2MatchStore,
  key: string,
  effects: number,
): ScoutGuardedEffectV2Result {
  if (store.completedClaims.has(key)) {
    // The reconcile the V2 contracts name: an earlier run claimed the guard
    // and completed it, so this attempt applies nothing.
    return {
      guard: { outcome: "already-applied" },
      fact: { outcome: "already-applied" },
      effects: 0,
    };
  }
  store.completedClaims.add(key);
  store.applied.push(key);
  return {
    guard: { outcome: "applied" },
    fact: { outcome: "applied" },
    effects,
  };
}

/** A resume point in which the named phases have already been attested. */
export function attestedPipelineState(
  riotMatchId: RiotMatchId,
  ...phases: readonly ScoutV2MatchPhase[]
): ScoutMatchPipelineStateV2Result {
  return {
    kind: "present",
    state: {
      riotMatchId,
      owner: { kind: "temporal-v2" },
      policy: "FULL",
      deliveryMode: "live",
      promoted: false,
      receiptKinds: phases.map((phase) => SCOUT_V2_MATCH_RECEIPT_KINDS[phase]),
      intents: [],
      trackedAccounts: { total: 2, cursorAdvanced: 2 },
    },
  };
}

/**
 * The nine per-match Activities, backed by {@link ScoutV2MatchStore}.
 *
 * The injected failure is non-retryable so the Activity does not quietly
 * re-enter the stub four more times on its way to failing the Workflow.
 */
export function scoutV2MatchActivityStubs(store: ScoutV2MatchStore) {
  const record = (call: string): void => {
    store.calls.push(call);
    if (call === store.failAt) {
      throw ApplicationFailure.nonRetryable(
        `injected crash at ${call}`,
        "InjectedCrash",
      );
    }
  };
  return {
    readMatchPipelineStateV2: (): ScoutMatchPipelineStateV2Result => {
      record("readMatchPipelineStateV2");
      if (!store.observed) return { kind: "absent" };
      return {
        kind: "present",
        state: {
          riotMatchId: MATCH_ID,
          owner: store.owner,
          policy: store.policy,
          deliveryMode: store.deliveryMode,
          promoted: false,
          receiptKinds: [...store.receiptKinds],
          intents: [],
          trackedAccounts: {
            total: store.trackedAccounts,
            cursorAdvanced: store.cursorAdvanced,
          },
        },
      };
    },
    archiveMatchArtifactsV2: (): ScoutArchiveV2Result => {
      record("archiveMatchArtifactsV2");
      if (store.archiveConflictsOnce && !store.archiveConflicted) {
        store.archiveConflicted = true;
        return {
          artifacts: [
            {
              descriptor: MATCH_ARTIFACT,
              outcome: "stored",
              receipt: {
                kind: RAW_ARCHIVE_MATCH,
                commit: {
                  outcome: "conflict",
                  reason: "receipt-evidence-mismatch",
                },
              },
            },
          ],
        };
      }
      if (store.archiveConflicted) {
        // The read gate: a receipt already stands, so this attempt reports the
        // first writer's descriptor and writes nothing.
        return {
          artifacts: [
            {
              descriptor: MATCH_ARTIFACT,
              outcome: "already-stored",
              receipt: {
                kind: RAW_ARCHIVE_MATCH,
                commit: { outcome: "already-applied" },
              },
            },
          ],
        };
      }
      // Content-addressed: a repeat writes the same bytes to the same key, so
      // it is not a second effect and is deliberately not recorded as one.
      return { artifacts: [] };
    },
    commitMatchObservationV2: (
      input: ScoutMatchObservationV2Input,
    ): ScoutMatchObservationV2Result => {
      record("commitMatchObservationV2");
      store.observationSources.push(input.sourcePuuid);
      store.observationDeliveryModes.push(input.deliveryMode);
      const commit: ScoutDurableCommitV2 = {
        outcome: store.observed ? "already-applied" : "applied",
      };
      store.observed = true;
      return {
        commit,
        owner: store.owner,
        policy: store.policy,
        // The stub mirrors the real Activity: the mode comes back from the
        // stored row, so an input that carried none still gets the committed
        // one and a restart cannot invent a different answer.
        deliveryMode: store.deliveryMode,
        promoted: false,
      };
    },
    settleMatchMarketsV2: (): ScoutGuardedEffectV2Result => {
      record("settleMatchMarketsV2");
      return guardedEffect(store, "settlement", 3);
    },
    applyMatchProgressionV2: (): ScoutGuardedEffectV2Result => {
      record("applyMatchProgressionV2");
      return guardedEffect(store, "progression", 2);
    },
    recordMatchReceiptsV2: (
      input: ScoutMatchReceiptsV2Input,
    ): ScoutReceiptsV2Result => {
      record("recordMatchReceiptsV2");
      if (store.receiptsConflict) {
        // What a conflict IS: a receipt of that kind already stands carrying
        // different evidence — so the kind is in the resume state whether or
        // not this run agreed with it. The real Activity also records the
        // durable marker; a store that forgot either half would let the
        // replay tests pass for the wrong reason.
        for (const kind of input.kinds) {
          if (!store.receiptKinds.includes(kind)) store.receiptKinds.push(kind);
        }
        if (
          !store.receiptKinds.includes(
            SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
          )
        ) {
          store.receiptKinds.push(SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND);
        }
        return {
          receipts: input.kinds.map((kind) => ({
            kind,
            commit: {
              outcome: "conflict",
              reason: "receipt-evidence-mismatch",
            },
          })),
        };
      }
      return {
        receipts: input.kinds.map((kind) => {
          const stored = store.receiptKinds.includes(kind);
          if (!stored) store.receiptKinds.push(kind);
          return {
            kind,
            commit: { outcome: stored ? "already-applied" : "applied" },
          };
        }),
      };
    },
    finalizeTournamentResultV2: (): ScoutTournamentResultV2Result => {
      record("finalizeTournamentResultV2");
      if (!store.tournamentMatch) return { outcome: "not-a-tournament-match" };
      const already = store.completedClaims.has("tournament");
      store.completedClaims.add("tournament");
      if (!already) store.applied.push("tournament");
      return already
        ? { outcome: "already-finalized", publishedNight: true }
        : { outcome: "finalized", publishedNight: true };
    },
    advanceMatchCursorV2: (): ScoutMatchCursorV2Result => {
      record("advanceMatchCursorV2");
      const advanced = store.trackedAccounts - store.cursorAdvanced;
      if (advanced > 0) store.applied.push("cursor");
      const alreadyAdvanced = store.cursorAdvanced;
      store.cursorAdvanced = store.trackedAccounts;
      return { advanced, alreadyAdvanced };
    },
    runPostMatchMaintenance: (input: {
      settleDareV2Deadlines: boolean;
      evidenceWatermark?: string;
      pollOwner?: string;
    }): void => {
      record("runPostMatchMaintenance");
      store.maintenance.push(input);
      if (store.maintenanceFailures > 0) {
        store.maintenanceFailures -= 1;
        // A plain Error is retryable, so Temporal retries the ACTIVITY and the
        // Workflow resumes from history without re-running discovery.
        throw new Error("maintenance attempt failed");
      }
    },
    mintPostmatchNotificationIntentsV2: (): ScoutMintedIntentsV2Result => {
      record("mintPostmatchNotificationIntentsV2");
      // The real Activity is read-gated, so a resumed run mints nothing new;
      // the store counts calls, which is what the ordering tests assert on.
      return store.deliveryMode === "silent-backfill"
        ? { minted: 0, existing: 0, conflicts: 0, silent: 1 }
        : { minted: 1, existing: 0, conflicts: 0, silent: 0 };
    },
    planMatchFanOutV2: (): ScoutFanOutV2Result => {
      record("planMatchFanOutV2");
      return {
        notificationIntentKeys: [INTENT_KEY],
        lakeProjection: true,
      };
    },
  };
}

/**
 * `BotState`'s poll columns, as the durable claim treats them.
 *
 * The Workflow tests have no database, but the question they have to answer is
 * about a row two executions share: does the poll one run opened still hold
 * when another run's discovery asks for it, and does the first run's close
 * name the poll it opened. So the two statements the real repository makes —
 * a claim that applies only while no live poll holds the row, and a close
 * guarded on the claimed instant — are modelled here, and the Postgres
 * versions of exactly these are proven against a real database in
 * `post-match-poll-ownership.integration.test.ts`.
 */
export type ScoutV2PollRow = {
  status: "idle" | "running";
  startedAt: string | null;
  /** Every close that landed, by the poll instant it landed on. */
  closed: string[];
  /** The next claim's instant; a counter so the tests read deterministically. */
  claims: number;
};

export function createScoutV2PollRow(): ScoutV2PollRow {
  return { status: "idle", startedAt: null, closed: [], claims: 0 };
}

export function claimScoutV2Poll(
  row: ScoutV2PollRow,
): { outcome: "claimed"; pollOwner: string } | { outcome: "held" } {
  if (row.status === "running") return { outcome: "held" };
  row.claims += 1;
  const pollOwner = new Date(
    Date.UTC(2026, 8, 17, 10, row.claims, 0),
  ).toISOString();
  row.status = "running";
  row.startedAt = pollOwner;
  return { outcome: "claimed", pollOwner };
}

/**
 * Close the poll, guarded on the owner when one is presented.
 *
 * An unowned close overwrites whatever stands — v1's close, and what a V2 run
 * that lost track of its claim would do. That is the defect: it lands on the
 * poll of whichever run happens to be holding the row.
 */
export function closeScoutV2Poll(
  row: ScoutV2PollRow,
  pollOwner: string | undefined,
): void {
  if (pollOwner !== undefined && row.startedAt !== pollOwner) {
    throw ApplicationFailure.nonRetryable(
      `Refusing to close the post-match poll claimed at ${pollOwner}: the row names ${row.startedAt ?? "no poll"}`,
      "PostMatchPollOwnershipError",
    );
  }
  if (row.startedAt !== null) row.closed.push(row.startedAt);
  row.status = "idle";
  row.startedAt = null;
}
