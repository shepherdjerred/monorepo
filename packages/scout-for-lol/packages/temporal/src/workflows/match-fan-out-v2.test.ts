import { describe, expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { ScoutNotificationIntentKeySchema } from "#src/contracts-v2.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutLakeProjectionV2WorkflowId,
  scoutNotificationV2WorkflowId,
} from "#src/identifiers.ts";
import {
  scoutLakeProjectionV2InputCodec,
  scoutNotificationV2InputCodec,
} from "#src/workflow-contracts-v2.ts";
import {
  IMPLEMENTED_V2_FAN_OUT_WORKFLOWS,
  planMatchFanOutChildrenV2,
  startableMatchFanOutCountsV2,
} from "./match-fan-out-v2.ts";

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
      planMatchFanOutChildrenV2({
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
        workflowType: SCOUT_WORKFLOW_NAMES.notificationV2,
        workflowId: scoutNotificationV2WorkflowId(stage, first),
        input: scoutNotificationV2InputCodec.serialize({
          stage,
          intentKey: first,
        }),
      },
      {
        family: "notifications",
        workflowType: SCOUT_WORKFLOW_NAMES.notificationV2,
        workflowId: scoutNotificationV2WorkflowId(stage, second),
        input: scoutNotificationV2InputCodec.serialize({
          stage,
          intentKey: second,
        }),
      },
      {
        family: "lakeProjections",
        workflowType: SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
        workflowId: scoutLakeProjectionV2WorkflowId(stage, riotMatchId),
        input: scoutLakeProjectionV2InputCodec.serialize({
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
    const [notification] = planMatchFanOutChildrenV2({
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
      planMatchFanOutChildrenV2({
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
    expect([...IMPLEMENTED_V2_FAN_OUT_WORKFLOWS]).toEqual([
      SCOUT_WORKFLOW_NAMES.notificationV2,
      SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
    ]);
    expect(
      startableMatchFanOutCountsV2(
        planMatchFanOutChildrenV2({
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
      startableMatchFanOutCountsV2(
        planMatchFanOutChildrenV2({
          stage,
          riotMatchId,
          plan: { notificationIntentKeys: [], lakeProjection: false },
        }),
      ),
    ).toEqual({ notifications: 0, lakeProjections: 0 });
  });
});
