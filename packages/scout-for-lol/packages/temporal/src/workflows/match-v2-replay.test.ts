import { expect, test } from "vitest";
import { Worker } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { scoutPostMatchDiscoveryV2InputCodec } from "#src/workflow-contracts-v2.ts";
import { scoutPostMatchDiscoveryV2Workflow } from "./index.ts";
import {
  createScoutV2MatchStore,
  scoutV2MatchActivityStubs,
  MATCH_ID,
} from "./match-v2.test-fixtures.ts";
import { useScoutV2WorkflowHarness } from "./workflow-harness.test-fixtures.ts";

/**
 * The legacy discovery branch, replayed against a history that predates it.
 *
 * A required field added to a recorded RESULT can be read around, because the
 * payload is that execution's own fact. A recorded COMMAND's arguments cannot:
 * the child start is already in history, and whatever the legacy branch puts
 * on the page travels into it. So this proves the branch adds nothing, the
 * only way that can be proved — by replaying the older generation's sequence.
 *
 * The fixture rewrites payloads and removes no events, because this
 * generation differs from the current one only in what its payloads carried.
 */

const harness = useScoutV2WorkflowHarness();

type History = Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>;

const stage = "dev" as const;
const SOURCE_PUUID = LeaguePuuidSchema.parse("s".repeat(78));
const POLL_OWNER = IsoInstantSchema.parse("2026-09-13T07:59:00.000Z");

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
