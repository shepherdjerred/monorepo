import { expect, test } from "vitest";
import { Worker } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  scoutMatchProcessingV2InputCodec,
  scoutPostMatchDiscoveryV2InputCodec,
} from "#src/workflow-contracts-v2.ts";
import {
  scoutMatchProcessingV2Workflow,
  scoutPostMatchDiscoveryV2Workflow,
} from "./index.ts";
import { SCOUT_V2_MATCH_MINT_INTENTS_PATCH } from "./match-v2.ts";
import {
  createScoutV2MatchStore,
  scoutV2MatchActivityStubs,
  MATCH_ID,
} from "./match-v2.test-fixtures.ts";
import { useScoutV2WorkflowHarness } from "./workflow-harness.test-fixtures.ts";

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

test("a discovery recorded before the page carried matches still replays", async () => {
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
      workflowId: "discovery-pre-matches-history",
      args: [
        scoutPostMatchDiscoveryV2InputCodec.serialize({
          stage,
          trigger: "schedule",
        }),
      ],
    });
  await handle.result();

  const rewritten = historyAsPreChangeGeneration(await handle.fetchHistory());

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
 * The events the mint generation added: the marker `patched` wrote and the
 * mint's own schedule.
 *
 * The marker is matched by the SDK's own marker name rather than by decoding
 * its details, and the caller asserts that exactly one such marker exists —
 * so if a second patch is ever added to this Workflow, this fixture fails
 * loudly instead of quietly stripping the wrong one.
 */
function isMintEvent(event: Event): boolean {
  const scheduled =
    event.activityTaskScheduledEventAttributes?.activityType?.name;
  return (
    scheduled === "mintPostmatchNotificationIntentsV2" || namesThisPatch(event)
  );
}

/**
 * Whether this event is the marker for THIS patch.
 *
 * Matching on the marker name alone is not enough: the Workflow UI
 * interceptor records a patch of its own, so a history carries two, and
 * stripping the wrong one would leave the gate reading true while the mint's
 * events were gone. The id is read from the marker's own payload bytes.
 */
function namesThisPatch(event: Event): boolean {
  const marker = event.markerRecordedEventAttributes;
  if (marker?.markerName !== PATCH_MARKER) return false;
  const decoder = new TextDecoder();
  return Object.values(marker.details ?? {}).some((payloads) =>
    (payloads.payloads ?? []).some((payload) =>
      decoder
        .decode(payload.data ?? new Uint8Array())
        .includes(SCOUT_V2_MATCH_MINT_INTENTS_PATCH),
    ),
  );
}

/** The marker name the TypeScript SDK records `patched` calls under. */
const PATCH_MARKER = "core_patch";

function historyWithoutTheMint(history: History): History {
  const events = history.events ?? [];
  const mintScheduledIds = new Set(
    events
      .filter(
        (event) =>
          event.activityTaskScheduledEventAttributes?.activityType?.name ===
          "mintPostmatchNotificationIntentsV2",
      )
      .map((event) => Number(event.eventId)),
  );
  // The gated block emits three commands in one Workflow task, in this order:
  // the patch marker, the phase upsert `setWorkflowPhase` makes, and the mint
  // itself. A generation without the mint emitted none of them, so the upsert
  // between the marker and the schedule goes too — leaving it behind makes
  // replay fail on an event the pre-change code never produced.
  const markerId = Number(
    events.find((event) => namesThisPatch(event))?.eventId ?? 0,
  );
  const mintScheduledId = Math.min(...mintScheduledIds);
  const isGatedPhaseUpsert = (event: Event): boolean =>
    event.upsertWorkflowSearchAttributesEventAttributes != null &&
    Number(event.eventId) > markerId &&
    Number(event.eventId) < mintScheduledId;
  const dropped = events.filter((event) => {
    if (isGatedPhaseUpsert(event)) return true;
    if (isMintEvent(event)) return true;
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
  const preChange = historyWithoutTheMint(recorded);

  // The fixture is only a pre-change history if it lost BOTH the marker and
  // the mint's three events; a strip that silently matched neither would make
  // this test pass for the wrong reason.
  expect(
    (recorded.events ?? []).filter((event) => namesThisPatch(event)),
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
