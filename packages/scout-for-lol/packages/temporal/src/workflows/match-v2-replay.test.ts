import { expect, test } from "vitest";
import { historyFromJSON } from "@temporalio/common/lib/proto-utils.js";
import { Worker } from "@temporalio/worker";
import { DeterminismViolationError } from "@temporalio/workflow";
import type { WorkflowHandle } from "@temporalio/client";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  scoutMatchProcessingV2InputCodec,
  scoutPostMatchDiscoveryV2InputCodec,
  scoutPrematchDiscoveryV2InputCodec,
} from "#src/workflow-contracts-v2.ts";
import {
  scoutMatchProcessingV2Workflow,
  scoutPostMatchDiscoveryV2Workflow,
  scoutPrematchDiscoveryV2Workflow,
} from "./index.ts";
import { SCOUT_V2_MATCH_MINT_INTENTS_PATCH } from "./match-v2.ts";
import {
  SCOUT_V2_POSTMATCH_OWNERSHIP_PATCH,
  SCOUT_V2_POSTMATCH_OWNERSHIP_RETIRED_PATCH,
} from "./ownership/postmatch-ownership-v2.ts";
import recordedOwnershipGate from "./ownership/fixtures/dev-postmatch-discovery.ownership-gate.json" with { type: "json" };
import {
  createScoutV2MatchStore,
  scoutV2MatchActivityStubs,
  MATCH_ID,
} from "./match-v2.test-fixtures.ts";
import { useScoutV2WorkflowHarness } from "./workflow-harness.test-fixtures.ts";
import { SCOUT_V2_PREMATCH_MAINTENANCE_PATCH } from "./prematch-v2.ts";
import {
  createScoutV2PrematchStore,
  scoutV2PrematchActivityStubs,
} from "./prematch-v2.test-fixtures.ts";

/**
 * This Workflow family, replayed against histories older than the code.
 *
 * Both cases here exist because a compatibility claim about a recorded
 * history can only be proved against one, and the repository holds none. Each
 * builds the missing history from a real run, and the two build it
 * differently because the generations differ differently:
 *
 * - The discovery case rewrites payload BYTES and removes no events. That
 *   generation ran the same commands in the same order and differed only in
 *   what they carried.
 * - The mint case removes EVENTS and renumbers what refers to them. That
 *   generation ran one command fewer.
 *
 * Which technique a future change needs follows from which axis it moved. A
 * required field added to a recorded result is the first; an inserted,
 * removed or reordered Activity is the second.
 *
 * A generation the current code can no longer PRODUCE needs a third: a
 * committed fixture recorded from the older source. The retired ownership
 * read is that case, and its pre-ownership history is then derived from the
 * fixture with the second technique.
 */

const harness = useScoutV2WorkflowHarness();

type History = Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>;
type Event = NonNullable<History["events"]>[number];

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
  const store = createScoutV2MatchStore();
  await harness.startWorkers({
    ...scoutV2MatchActivityStubs(store),
    discoverPostMatchIdsV2: () => ({
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
    .workflow.start(scoutPostMatchDiscoveryV2Workflow, {
      taskQueue: "scout-dev",
      workflowId: workflowId,
      args: [
        scoutPostMatchDiscoveryV2InputCodec.serialize({
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

// ─── A per-match run whose history predates the mint ───────────────────────

/**
 * One patch-gated Activity: the patch id `patched` records and the Activity
 * the gated block schedules.
 */
type PatchedActivity = {
  readonly patchId: string;
  readonly activityType: string;
};

const MINT: PatchedActivity = {
  patchId: SCOUT_V2_MATCH_MINT_INTENTS_PATCH,
  activityType: "mintPostmatchNotificationIntentsV2",
};

const OWNERSHIP: PatchedActivity = {
  patchId: SCOUT_V2_POSTMATCH_OWNERSHIP_PATCH,
  activityType: "resolvePostMatchDiscoveryOwnerV2",
};

/**
 * The events a patch generation added: the marker `patched` wrote and the
 * gated Activity's own schedule.
 *
 * The marker is matched by the SDK's own marker name and its patch id, and
 * the caller asserts that exactly one such marker exists, so a fixture that
 * matched the wrong marker fails loudly instead of quietly stripping it.
 */
function isGatedEvent(event: Event, gate: PatchedActivity): boolean {
  const scheduled =
    event.activityTaskScheduledEventAttributes?.activityType?.name;
  return scheduled === gate.activityType || namesPatch(event, gate.patchId);
}

/**
 * Whether this event is the marker for the named patch.
 *
 * Matching on the marker name alone is not enough: the Workflow UI
 * interceptor records a patch of its own, so a history carries two, and
 * stripping the wrong one would leave the gate reading true while the mint's
 * events were gone. The id is read from the marker's own payload bytes.
 */
function namesPatch(event: Event, patchId: string): boolean {
  const marker = event.markerRecordedEventAttributes;
  if (marker?.markerName !== PATCH_MARKER) return false;
  const decoder = new TextDecoder();
  return Object.values(marker.details ?? {}).some((payloads) =>
    (payloads.payloads ?? []).some((payload) =>
      decoder.decode(payload.data ?? new Uint8Array()).includes(patchId),
    ),
  );
}

/** The marker name the TypeScript SDK records `patched` calls under. */
const PATCH_MARKER = "core_patch";

function historyWithoutPatchedActivity(
  history: History,
  gate: PatchedActivity,
): History {
  const events = history.events ?? [];
  const mintScheduledIds = new Set(
    events
      .filter(
        (event) =>
          event.activityTaskScheduledEventAttributes?.activityType?.name ===
          gate.activityType,
      )
      .map((event) => Number(event.eventId)),
  );
  // A patch marker is followed directly by the search-attribute upsert the
  // SDK records with it. A generation without the patch emitted neither, so
  // that upsert goes too. Only that one: another patch's marker and upsert
  // can sit between this marker and the gated schedule (the UI interceptor's
  // does when the gate is a Workflow's first command), and the older
  // generation recorded those.
  const markerId = Number(
    events.find((event) => namesPatch(event, gate.patchId))?.eventId ?? 0,
  );
  const isGatedPatchUpsert = (event: Event): boolean =>
    event.upsertWorkflowSearchAttributesEventAttributes != null &&
    Number(event.eventId) === markerId + 1;
  const dropped = events.filter((event) => {
    if (isGatedPatchUpsert(event)) return true;
    if (isGatedEvent(event, gate)) return true;
    const started = event.activityTaskStartedEventAttributes?.scheduledEventId;
    const completed =
      event.activityTaskCompletedEventAttributes?.scheduledEventId;
    return (
      (started !== undefined &&
        started !== null &&
        mintScheduledIds.has(Number(started))) ||
      (completed !== undefined &&
        completed !== null &&
        mintScheduledIds.has(Number(completed)))
    );
  });
  const droppedIds = new Set(dropped.map((event) => Number(event.eventId)));
  const kept = events.filter((event) => !droppedIds.has(Number(event.eventId)));
  const renumbered = new Map<number, number>();
  kept.forEach((event, index) => {
    renumbered.set(Number(event.eventId), index + 1);
  });
  // Every id reference in a history event lives under a key ending in
  // `EventId`, so remapping by key name is exhaustive without enumerating the
  // dozen attribute shapes that carry one.
  // Rewritten IN PLACE rather than rebuilt. Two things here are values, not
  // structures: a payload's `metadata` holds byte arrays, and event ids arrive
  // as Long instances — rebuilding either through `Object.entries` turns it
  // into an index-keyed object, and the Workflow then fails at start with an
  // unreadable encoding. Mutating only the id fields cannot do that.
  const remapIds = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) remapIds(entry);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if (ArrayBuffer.isView(value)) return;
    if ("low" in value && "high" in value && "unsigned" in value) return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "eventId" || key.endsWith("EventId")) {
        const mapped = renumbered.get(Number(entry));
        if (mapped !== undefined) Reflect.set(value, key, mapped);
        continue;
      }
      remapIds(entry);
    }
  };
  for (const event of kept) remapIds(event);
  // Activity ids come from a counter the SDK advances once per scheduled
  // activity, so a generation that never scheduled the mint numbered the
  // activities AFTER it one lower. Leaving the recorded numbering in place
  // makes replay fail on the id rather than on the command, which would be a
  // defect in the fixture rather than in the code under test.
  let activityNumber = 0;
  for (const event of kept) {
    const scheduled = event.activityTaskScheduledEventAttributes;
    if (scheduled === undefined || scheduled === null) continue;
    activityNumber += 1;
    scheduled.activityId = String(activityNumber);
  }
  return { events: kept };
}

test("a history recorded before the mint existed still replays", async () => {
  const store = createScoutV2MatchStore();
  await harness.startWorkers(scoutV2MatchActivityStubs(store));
  const handle = await harness
    .client()
    .workflow.start(scoutMatchProcessingV2Workflow, {
      taskQueue: "scout-dev",
      workflowId: "match-core-pre-mint-history",
      args: [
        scoutMatchProcessingV2InputCodec.serialize({
          stage: "dev",
          riotMatchId: RiotMatchIdSchema.parse(MATCH_ID),
        }),
      ],
    });
  await handle.result();

  const recorded = await handle.fetchHistory();
  const preChange = historyWithoutPatchedActivity(recorded, MINT);

  // The fixture is only a pre-change history if it lost BOTH the marker and
  // the mint's three events; a strip that silently matched neither would make
  // this test pass for the wrong reason.
  expect(
    (recorded.events ?? []).filter((event) => namesPatch(event, MINT.patchId)),
  ).toHaveLength(1);
  expect(
    (recorded.events ?? []).filter(
      (event) =>
        event.activityTaskScheduledEventAttributes?.activityType?.name ===
        "mintPostmatchNotificationIntentsV2",
    ),
  ).toHaveLength(1);
  // Five events leave: the marker, the phase upsert, and the mint's schedule,
  // start and completion.
  expect((preChange.events ?? []).length).toBe(
    (recorded.events ?? []).length - 5,
  );
  // And the patch it recorded is the one this gate names.
  expect(SCOUT_V2_MATCH_MINT_INTENTS_PATCH).toBe("scout-v2-match-mint-intents");

  await Worker.runReplayHistory(
    { workflowsPath: new URL("index.ts", import.meta.url).pathname },
    preChange,
  );
}, 120_000);

// ─── Discoveries recorded around the retired ownership read ────────────────

/**
 * A discovery recorded while the ownership read existed.
 *
 * The time-skipping environment can only record what the CURRENT code does,
 * and the current code no longer asks, so this generation is a committed
 * fixture: one discovery of one match, recorded by running the Workflow
 * source from before the retirement against `scoutV2MatchActivityStubs`, with
 * the ownership read answering `run-v2` as the flag did in every environment.
 * It is the shape of every discovery that can still be open when the
 * retirement deploys.
 */
function ownershipGateHistory(): History {
  return historyFromJSON(structuredClone(recordedOwnershipGate));
}

function ownershipReads(history: History): number {
  return (history.events ?? []).filter(
    (event) =>
      event.activityTaskScheduledEventAttributes?.activityType?.name ===
      OWNERSHIP.activityType,
  ).length;
}

function markersFor(history: History, patchId: string): number {
  return (history.events ?? []).filter((event) => namesPatch(event, patchId))
    .length;
}

test("a discovery recorded while the ownership read existed still replays", async () => {
  const recorded = ownershipGateHistory();

  // The fixture is that generation only if it asked exactly once and never
  // named the retirement.
  expect(markersFor(recorded, OWNERSHIP.patchId)).toBe(1);
  expect(ownershipReads(recorded)).toBe(1);
  expect(markersFor(recorded, SCOUT_V2_POSTMATCH_OWNERSHIP_RETIRED_PATCH)).toBe(
    0,
  );

  await Worker.runReplayHistory(
    { workflowsPath: new URL("index.ts", import.meta.url).pathname },
    recorded,
  );
}, 120_000);

test("the ownership fixture fails replay once its recorded read is changed", async () => {
  // The negative control: a replay that accepted any command where the
  // ownership read was recorded would pass the test above for the wrong
  // reason. A bare `deprecatePatch` of the ownership patch is exactly such a
  // change, and fails here the same way.
  const tampered = historyFromJSON(
    JSON.parse(
      JSON.stringify(recordedOwnershipGate).replace(
        `"name":"${OWNERSHIP.activityType}"`,
        '"name":"tamperedActivity"',
      ),
    ),
  );
  expect(ownershipReads(tampered)).toBe(0);

  await expect(
    Worker.runReplayHistory(
      { workflowsPath: new URL("index.ts", import.meta.url).pathname },
      tampered,
    ),
  ).rejects.toBeInstanceOf(DeterminismViolationError);
}, 120_000);

test("a discovery recorded before the ownership read still replays", async () => {
  const recorded = ownershipGateHistory();
  const preChange = historyWithoutPatchedActivity(recorded, OWNERSHIP);

  // The strip removed both the marker and the read; one that matched neither
  // would pass for the wrong reason.
  expect(markersFor(preChange, OWNERSHIP.patchId)).toBe(0);
  expect(ownershipReads(preChange)).toBe(0);
  expect((recorded.events ?? []).length - (preChange.events ?? []).length).toBe(
    5,
  );

  await Worker.runReplayHistory(
    { workflowsPath: new URL("index.ts", import.meta.url).pathname },
    preChange,
  );
}, 120_000);

test("a discovery recorded now names the retirement and never asks", async () => {
  const recorded = await recordOneMatchDiscovery("discovery-retired-ownership");

  expect(markersFor(recorded, SCOUT_V2_POSTMATCH_OWNERSHIP_RETIRED_PATCH)).toBe(
    1,
  );
  expect(markersFor(recorded, OWNERSHIP.patchId)).toBe(0);
  expect(ownershipReads(recorded)).toBe(0);
  expect(SCOUT_V2_POSTMATCH_OWNERSHIP_PATCH).toBe(
    "scout-v2-postmatch-ownership",
  );
  expect(SCOUT_V2_POSTMATCH_OWNERSHIP_RETIRED_PATCH).toBe(
    "scout-v2-retired-postmatch-ownership",
  );

  await Worker.runReplayHistory(
    { workflowsPath: new URL("index.ts", import.meta.url).pathname },
    recorded,
  );
}, 120_000);

// ─── A prematch poll whose history predates the maintenance tail ──────────

test("a prematch discovery recorded before the maintenance tail still replays", async () => {
  await harness.startWorkers(
    scoutV2PrematchActivityStubs(createScoutV2PrematchStore(), []),
  );
  const handle = await harness
    .client()
    .workflow.start(scoutPrematchDiscoveryV2Workflow, {
      taskQueue: "scout-dev",
      workflowId: "prematch-discovery-pre-maintenance-history",
      args: [scoutPrematchDiscoveryV2InputCodec.serialize({ stage })],
    });
  await handle.result();
  const recorded = await handle.fetchHistory();
  const maintenance: PatchedActivity = {
    patchId: SCOUT_V2_PREMATCH_MAINTENANCE_PATCH,
    activityType: "runPrematchMaintenance",
  };
  // A closed history from before the tail: it completed straight after
  // discovery, which is what a retained beta history replayed against the
  // candidate bundle looks like.
  const preChange = historyWithoutPatchedActivity(recorded, maintenance);

  expect(markersFor(recorded, maintenance.patchId)).toBe(1);
  expect((recorded.events ?? []).length - (preChange.events ?? []).length).toBe(
    5,
  );
  expect(SCOUT_V2_PREMATCH_MAINTENANCE_PATCH).toBe(
    "scout-v2-prematch-maintenance",
  );

  await Worker.runReplayHistory(
    { workflowsPath: new URL("index.ts", import.meta.url).pathname },
    preChange,
  );
}, 120_000);
