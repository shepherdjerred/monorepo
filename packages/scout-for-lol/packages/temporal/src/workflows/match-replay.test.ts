import { expect, test } from "vitest";
import { Worker } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  scoutMatchProcessingInputCodec,
  scoutPostMatchDiscoveryInputCodec,
  scoutPrematchDiscoveryInputCodec,
  scoutPrematchGameInputCodec,
} from "#src/workflow-contracts.ts";
import {
  scoutMatchProcessingWorkflow,
  scoutPostMatchDiscoveryWorkflow,
  scoutPrematchDiscoveryWorkflow,
  scoutPrematchGameWorkflow,
} from "./index.ts";
import { SCOUT_GENERATION_RENAME_PATCH } from "./generation-rename.ts";
import { SCOUT_MATCH_MINT_INTENTS_PATCH } from "./match.ts";
import {
  SCOUT_PREMATCH_DELIVERY_PATCH,
  SCOUT_PREMATCH_MAINTENANCE_PATCH,
} from "./prematch.ts";
import { SCOUT_POSTMATCH_OWNERSHIP_RETIRED_PATCH } from "./retired-ownership.ts";
import {
  SCOUT_ARCHIVE_ONLY_NO_EFFECTS_PATCH,
  SCOUT_MATCH_EVIDENCE_PREPARATION_PATCH,
} from "./evidence/match.ts";
import {
  expectRetiredGatesReplay,
  recordedPatchMarkers,
} from "./retired-patches.test-fixtures.ts";
import {
  createScoutMatchStore,
  scoutMatchActivityStubs,
  MATCH_ID,
} from "./match.test-fixtures.ts";
import { useScoutWorkflowHarness } from "./workflow-harness.test-fixtures.ts";
import {
  createScoutPrematchStore,
  GAME_REF,
  scoutPrematchActivityStubs,
} from "./prematch.test-fixtures.ts";

/**
 * This Workflow family, replayed against histories older than the code.
 *
 * A compatibility claim about a recorded history can only be proved against
 * one, so each case builds that history from a real run:
 *
 * - The discovery case rewrites payload BYTES and removes no events. That
 *   generation ran the same commands in the same order and differed only in
 *   what they carried.
 * - The retired-gate cases rewrite each deprecated patch marker back to the
 *   non-deprecated marker the gated release recorded. Retained histories
 *   carry exactly those, and core refuses a non-deprecated marker no command
 *   claims, so the replay proves each `deprecatePatch` still claims its
 *   marker at the command where the gate stood.
 */

const harness = useScoutWorkflowHarness();

type History = Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>;

const stage = "dev" as const;
const SOURCE_PUUID = LeaguePuuidSchema.parse("s".repeat(78));
const POLL_OWNER = IsoInstantSchema.parse("2026-09-13T07:59:00.000Z");

// ─── A discovery whose page predates `matches` ─────────────────────────────
/**
 * Rewrite one JSON payload in place, and ONLY when the transform changed it.
 *
 * Re-encoding a payload the transform did not touch is not harmless: an
 * Activity result that is an array comes back as an index-keyed object from a
 * spread, and the replay then fails on a corrupted fixture rather than on the
 * code. The transform reports whether it applied, and untouched bytes are
 * left exactly as recorded.
 */
function rewritePayload(
  payloads:
    | {
        data?: Uint8Array | null;
        metadata?: Record<string, Uint8Array> | null;
      }[]
    | null
    | undefined,
  transform: (value: Record<string, unknown>) => boolean,
): number {
  let rewritten = 0;
  for (const payload of payloads ?? []) {
    if (payload.data == null) continue;
    // An Activity that returns nothing records a payload with a null encoding
    // and no bytes, so the encoding is checked rather than the length.
    const encoding = payload.metadata?.["encoding"];
    if (encoding === undefined) continue;
    if (Buffer.from(encoding).toString("utf8") !== "json/plain") continue;
    const decoded: unknown = JSON.parse(
      Buffer.from(payload.data).toString("utf8"),
    );
    if (typeof decoded !== "object" || decoded === null) continue;
    if (Array.isArray(decoded)) continue;
    const record: Record<string, unknown> = { ...decoded };
    if (!transform(record)) continue;
    payload.data = Buffer.from(JSON.stringify(record), "utf8");
    rewritten += 1;
  }
  return rewritten;
}

/**
 * The same history as the generation before `matches`, `pollOwner` and the
 * child's two optional fields existed.
 *
 * Only payload BYTES change: that generation ran the same commands in the same
 * order, and differed solely in what those commands carried. Every count is
 * returned so the test can refuse a fixture that rewrote nothing.
 */
function historyAsPreChangeGeneration(history: History): {
  history: History;
  scans: number;
  childStarts: number;
  maintenance: number;
} {
  let scans = 0;
  let childStarts = 0;
  let maintenance = 0;
  for (const event of history.events ?? []) {
    const scheduled = event.activityTaskScheduledEventAttributes;
    if (scheduled?.activityType?.name === "runPostMatchMaintenance") {
      maintenance += rewritePayload(scheduled.input?.payloads, (value) => {
        if (!("pollOwner" in value)) return false;
        delete value["pollOwner"];
        return true;
      });
    }
    const child = event.startChildWorkflowExecutionInitiatedEventAttributes;
    if (child != null) {
      childStarts += rewritePayload(child.input?.payloads, (envelope) => {
        const data = envelope["data"];
        if (typeof data !== "object" || data === null) return false;
        const fields: Record<string, unknown> = { ...data };
        if (!("sourcePuuid" in fields) && !("deliveryMode" in fields)) {
          return false;
        }
        delete fields["sourcePuuid"];
        delete fields["deliveryMode"];
        envelope["data"] = fields;
        return true;
      });
    }
    const completed = event.activityTaskCompletedEventAttributes;
    if (completed != null) {
      scans += rewritePayload(completed.result?.payloads, (value) => {
        if (!("riotMatchIds" in value)) return false;
        delete value["matches"];
        delete value["pollOwner"];
        return true;
      });
    }
  }
  return { history, scans, childStarts, maintenance };
}

/**
 * Run one discovery of a single live match to completion and return its
 * recorded history, which each replay case below then rewrites.
 */
async function recordOneMatchDiscovery(workflowId: string): Promise<History> {
  const store = createScoutMatchStore();
  await harness.startWorkers({
    ...scoutMatchActivityStubs(store),
    discoverPostMatchIds: () => ({
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
    }),
  });
  const handle = await harness
    .client()
    .workflow.start(scoutPostMatchDiscoveryWorkflow, {
      taskQueue: "scout-dev",
      workflowId: workflowId,
      args: [
        scoutPostMatchDiscoveryInputCodec.serialize({
          stage,
          trigger: "schedule",
        }),
      ],
    });
  await handle.result();
  return await handle.fetchHistory();
}

test("a discovery recorded before the page carried matches still replays", async () => {
  const history = await recordOneMatchDiscovery(
    "discovery-pre-matches-history",
  );

  const rewritten = historyAsPreChangeGeneration(history);

  // A fixture that matched nothing would pass for the wrong reason.
  expect(rewritten.scans).toBe(1);
  expect(rewritten.childStarts).toBe(1);
  expect(rewritten.maintenance).toBe(1);
  expect(RiotMatchIdSchema.parse(MATCH_ID)).toBe(MATCH_ID);

  await Worker.runReplayHistory(
    { workflowsPath: new URL("index.ts", import.meta.url).pathname },
    rewritten.history,
  );
}, 120_000);

// ─── Histories recorded through the retired gates ─────────────────────────

/** The temporal-ui-current-details patch every phase update records. */
const UI_DETAILS_PATCH = "temporal-ui-current-details-v1";

/** Beta-only retired gates: dev and prod runs never evaluate them. */
const BETA_ONLY_PATCHES = [
  SCOUT_MATCH_EVIDENCE_PREPARATION_PATCH,
  SCOUT_ARCHIVE_ONLY_NO_EFFECTS_PATCH,
] as const;

test("a match run records its retired gates and replays as the gated release", async () => {
  await harness.startWorkers(scoutMatchActivityStubs(createScoutMatchStore()));
  const handle = await harness
    .client()
    .workflow.start(scoutMatchProcessingWorkflow, {
      taskQueue: "scout-dev",
      workflowId: "match-core-retired-gates",
      args: [
        scoutMatchProcessingInputCodec.serialize({
          stage,
          riotMatchId: RiotMatchIdSchema.parse(MATCH_ID),
        }),
      ],
    });
  await handle.result();
  const recorded = await handle.fetchHistory();

  expect(
    (recorded.events ?? []).filter(
      (event) =>
        event.activityTaskScheduledEventAttributes?.activityType?.name ===
        "mintPostmatchNotificationIntents",
    ),
  ).toHaveLength(1);
  // A non-beta run takes the same path the beta-only gates never touched.
  expect(recordedPatchMarkers(recorded, BETA_ONLY_PATCHES)).toEqual({});
  await expectRetiredGatesReplay(recorded, [
    UI_DETAILS_PATCH,
    SCOUT_GENERATION_RENAME_PATCH,
    SCOUT_MATCH_MINT_INTENTS_PATCH,
  ]);
}, 120_000);

test("a non-beta archive-only match still finalizes and records no beta-only marker", async () => {
  const store = createScoutMatchStore({ policy: "ARCHIVE_ONLY" });
  await harness.startWorkers(scoutMatchActivityStubs(store));
  const handle = await harness
    .client()
    .workflow.start(scoutMatchProcessingWorkflow, {
      taskQueue: "scout-dev",
      workflowId: "match-core-archive-only-non-beta",
      args: [
        scoutMatchProcessingInputCodec.serialize({
          stage,
          riotMatchId: RiotMatchIdSchema.parse(MATCH_ID),
        }),
      ],
    });
  await handle.result();

  expect(store.calls).toContain("finalizeTournamentResult");
  expect(store.calls).not.toContain("settleMatchMarkets");
  expect(
    recordedPatchMarkers(await handle.fetchHistory(), BETA_ONLY_PATCHES),
  ).toEqual({});
}, 120_000);

test("a discovery records its retired gates and replays as the gated release", async () => {
  // Chunked dispatch's retired gate is covered by the dispatcher tests; this
  // page carries no game end, so it takes the direct child path.
  const recorded = await recordOneMatchDiscovery("discovery-retired-gates");

  expect(
    (recorded.events ?? []).filter(
      (event) =>
        event.activityTaskScheduledEventAttributes?.activityType?.name ===
        "resolvePostMatchDiscoveryOwnerV2",
    ),
  ).toHaveLength(0);
  await expectRetiredGatesReplay(recorded, [
    SCOUT_POSTMATCH_OWNERSHIP_RETIRED_PATCH,
    UI_DETAILS_PATCH,
  ]);
}, 120_000);

test("a prematch poll records its retired gates and replays as the gated release", async () => {
  await harness.startWorkers(
    scoutPrematchActivityStubs(createScoutPrematchStore(), []),
  );
  const handle = await harness
    .client()
    .workflow.start(scoutPrematchDiscoveryWorkflow, {
      taskQueue: "scout-dev",
      workflowId: "prematch-discovery-retired-gates",
      args: [scoutPrematchDiscoveryInputCodec.serialize({ stage })],
    });
  await handle.result();

  await expectRetiredGatesReplay(await handle.fetchHistory(), [
    UI_DETAILS_PATCH,
    SCOUT_GENERATION_RENAME_PATCH,
    SCOUT_PREMATCH_MAINTENANCE_PATCH,
  ]);
}, 120_000);

test("a prematch game records its retired gates and replays as the gated release", async () => {
  await harness.startWorkers(
    scoutPrematchActivityStubs(createScoutPrematchStore()),
  );
  const handle = await harness
    .client()
    .workflow.start(scoutPrematchGameWorkflow, {
      taskQueue: "scout-dev",
      workflowId: "prematch-game-retired-gates",
      args: [
        scoutPrematchGameInputCodec.serialize({ stage, gameRef: GAME_REF }),
      ],
    });
  await handle.result();

  await expectRetiredGatesReplay(await handle.fetchHistory(), [
    UI_DETAILS_PATCH,
    SCOUT_GENERATION_RENAME_PATCH,
    SCOUT_PREMATCH_DELIVERY_PATCH,
  ]);
}, 120_000);
