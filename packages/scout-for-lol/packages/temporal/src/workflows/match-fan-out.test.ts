import { describe, expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { ScoutNotificationIntentKeySchema } from "#src/pipeline-contracts.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutLakeProjectionWorkflowId,
  scoutNotificationWorkflowId,
} from "#src/identifiers.ts";
import {
  scoutLakeProjectionInputCodec,
  scoutNotificationInputCodec,
} from "#src/workflow-contracts.ts";
import {
  IMPLEMENTED_FAN_OUT_WORKFLOWS,
  planMatchFanOutChildren,
  startableMatchFanOutCounts,
} from "./match-fan-out.ts";

const stage = "prod" as const;
const riotMatchId = RiotMatchIdSchema.parse("NA1_5312279829");
const first = ScoutNotificationIntentKeySchema.parse(
  "postmatch-discord:NA1_5312279829:100000000000000001",
);
const second = ScoutNotificationIntentKeySchema.parse(
  "postmatch-discord:NA1_5312279829:100000000000000002",
);

describe("the post-commit fan-out plan", () => {
  test("names one child per read intent key, plus the lake projection", () => {
    expect(
      planMatchFanOutChildren({
        stage,
        riotMatchId,
        plan: {
          notificationIntentKeys: [first, second],
          lakeProjection: true,
        },
      }),
    ).toEqual([
      {
        family: "notifications",
        workflowType: SCOUT_WORKFLOW_NAMES.notification,
        workflowId: scoutNotificationWorkflowId(stage, first),
        input: scoutNotificationInputCodec.serialize({
          stage,
          intentKey: first,
        }),
      },
      {
        family: "notifications",
        workflowType: SCOUT_WORKFLOW_NAMES.notification,
        workflowId: scoutNotificationWorkflowId(stage, second),
        input: scoutNotificationInputCodec.serialize({
          stage,
          intentKey: second,
        }),
      },
      {
        family: "lakeProjections",
        workflowType: SCOUT_WORKFLOW_NAMES.lakeProjection,
        workflowId: scoutLakeProjectionWorkflowId(stage, riotMatchId),
        input: scoutLakeProjectionInputCodec.serialize({
          stage,
          riotMatchId,
        }),
      },
    ]);
  });

  test("keeps the child IDs derivable from the work itself", () => {
    // Every ID is computed from the intent key or the match id, so a
    // reconciliation sweep that rediscovers the same work collapses onto the
    // execution already driving it instead of racing a duplicate.
    const [notification] = planMatchFanOutChildren({
      stage,
      riotMatchId,
      plan: { notificationIntentKeys: [first], lakeProjection: false },
    });
    expect(notification?.workflowId).toBe(
      `scout-prod-notification-v2-${first}`,
    );
  });

  test("plans nothing when there is nothing committed to promise", () => {
    expect(
      planMatchFanOutChildren({
        stage,
        riotMatchId,
        plan: { notificationIntentKeys: [], lakeProjection: false },
      }),
    ).toEqual([]);
  });

  test("counts every planned child whose Workflow has a body", () => {
    // The seam: a lane that implements a child adds its type here and the
    // per-match Workflow starts every planned child of that type. Both have
    // landed, so every planned child is startable — and this staying a pure
    // predicate is what lets the fan-out decision be asserted without a
    // Temporal environment and without any child existing.
    expect([...IMPLEMENTED_FAN_OUT_WORKFLOWS]).toEqual([
      SCOUT_WORKFLOW_NAMES.notification,
      SCOUT_WORKFLOW_NAMES.lakeProjection,
    ]);
    expect(
      startableMatchFanOutCounts(
        planMatchFanOutChildren({
          stage,
          riotMatchId,
          plan: {
            notificationIntentKeys: [first, second],
            lakeProjection: true,
          },
        }),
      ),
    ).toEqual({ notifications: 2, lakeProjections: 1 });
  });

  test("counts nothing startable when nothing was planned", () => {
    // The count follows the PLAN, never the allowlist: a match with no intents
    // and no archived payload starts nothing however many types have bodies.
    expect(
      startableMatchFanOutCounts(
        planMatchFanOutChildren({
          stage,
          riotMatchId,
          plan: { notificationIntentKeys: [], lakeProjection: false },
        }),
      ),
    ).toEqual({ notifications: 0, lakeProjections: 0 });
  });
});

describe("the page a discovery result yields", () => {
  const MATCH_A = RiotMatchIdSchema.parse("NA1_7101");
  const SOURCE = LeaguePuuidSchema.parse("s".repeat(78));

  test("an oldest-generation result still yields a drivable page", async () => {
    // Bare ids, recorded before `matches` existed. Reading `scan.matches`
    // there is `undefined`, and iterating it fails the Workflow task on every
    // replay — a stuck execution rather than a failed one.
    const { discoveredMatchesOf } = await import("./match.ts");

    expect(discoveredMatchesOf({ riotMatchIds: [MATCH_A] })).toEqual([
      { riotMatchId: MATCH_A },
    ]);
  });

  test("a legacy page adds nothing the old child start did not carry", async () => {
    // The child start is a RECORDED command. A field added here travels into
    // its arguments, so replay would emit a child input that history does not
    // hold — nondeterminism before the child ever runs. `live` is still the
    // right answer for these matches; it is supplied inside the child, where
    // nothing has been recorded yet.
    const { discoveredMatchesOf } = await import("./match.ts");

    const [only] = discoveredMatchesOf({ riotMatchIds: [MATCH_A] });

    expect(only?.deliveryMode).toBeUndefined();
    expect(only?.sourcePuuid).toBeUndefined();
    expect(Object.keys(only ?? {})).toEqual(["riotMatchId"]);
  });

  test("a current result yields its matches whole", async () => {
    const { discoveredMatchesOf } = await import("./match.ts");
    const matches = [
      {
        riotMatchId: MATCH_A,
        sourcePuuid: SOURCE,
        deliveryMode: "silent-backfill" as const,
      },
    ];

    expect(discoveredMatchesOf({ riotMatchIds: [MATCH_A], matches })).toEqual(
      matches,
    );
  });

  test("refuses a current result whose matches are malformed", async () => {
    // A payload that claims the new shape but does not have it is a broken
    // contract, not a shape to guess at.
    const { discoveredMatchesOf } = await import("./match.ts");

    expect(() =>
      discoveredMatchesOf({ riotMatchIds: [MATCH_A], matches: [{}] }),
    ).toThrow();
  });
});

describe("the delivery mode a recorded observation reports", () => {
  test("reports the mode the payload recorded", async () => {
    const { observedDeliveryModeOf } = await import("./match.ts");

    expect(observedDeliveryModeOf({ deliveryMode: "silent-backfill" })).toBe(
      "silent-backfill",
    );
    expect(observedDeliveryModeOf({ deliveryMode: "live" })).toBe("live");
  });

  test("reports live for a payload recorded before the field existed", async () => {
    // The field was added as REQUIRED to two recorded Activity results at
    // once. A run replaying either from before spreads `undefined` into the
    // result codec, which requires it, and fails the Workflow task on every
    // replay — stuck, not failed. `live` is what the generation that recorded
    // those results observed: its commit stamped it unconditionally.
    const { observedDeliveryModeOf } = await import("./match.ts");

    expect(observedDeliveryModeOf({})).toBe("live");
  });
});
