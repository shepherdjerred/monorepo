import { describe, expect, test } from "vitest";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import {
  SCOUT_V2_REUSE_POLICIES,
  SCOUT_WORKFLOW_NAMES,
} from "@scout-for-lol/temporal";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  startScoutLakeProjectionV2,
  SCOUT_CLIENT_MATCH_START_DELAY,
  startScoutMatchProcessingV2,
  startScoutNotificationV2,
  startScoutPipelineReconciliationV2,
  type ScoutV2WorkflowStarter,
} from "#src/temporal/starts-v2.ts";
import { fakeV2Temporal as fakeTemporal } from "#src/testing/fake-v2-temporal.ts";

/**
 * What an operator start is allowed to re-run.
 *
 * The property under test is not "some policy is sent" but "the policy sent is
 * the one that admits the re-run this operation exists to perform". A
 * notification intent that an operator has just released from
 * `unknown-delivery` MUST get a fresh run even though the previous execution
 * COMPLETED, and a projection must re-run after a failure but not after a
 * success. Those are opposite answers, so a single uniform policy is wrong for
 * at least one of them whichever one is chosen.
 *
 * The fake (`#src/testing/fake-v2-temporal.ts`) models Temporal's documented
 * ID-reuse rule rather than calling a server.
 */

const INTENT_KEY = NotificationIntentKeySchema.parse(
  "notification:NA1_5312279829:channel:420003",
);
const MATCH_ID = RiotMatchIdSchema.parse("NA1_5312279829");
const NOTIFICATION_ID = `scout-beta-notification-v2-${INTENT_KEY}`;
const PROJECTION_ID = `scout-beta-lake-projection-v2-${MATCH_ID}`;
const SOURCE_PUUID = LeaguePuuidSchema.parse("p".repeat(78));

async function startNotification(client: ScoutV2WorkflowStarter) {
  return await startScoutNotificationV2(client, {
    stage: "beta",
    intentKey: INTENT_KEY,
  });
}

async function startProjection(client: ScoutV2WorkflowStarter) {
  return await startScoutLakeProjectionV2(client, {
    stage: "beta",
    riotMatchId: MATCH_ID,
  });
}

describe("operator starts share the sweep's per-family reuse policies", () => {
  test("each start sends exactly the shared table's policy for its family", async () => {
    // The drift guard. A policy spelled here a second time rather than read
    // from the table would pass every behavioural test below and still diverge
    // from the sweep the day the table changes.
    const { client, starts } = fakeTemporal();

    await startNotification(client);
    await startProjection(client);

    const [notification, projection] = starts;
    expect(notification?.options.workflowIdReusePolicy).toBe(
      SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.notificationV2],
    );
    expect(projection?.options.workflowIdReusePolicy).toBe(
      SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.lakeProjectionV2],
    );
  });

  test("every operator start joins a run already in flight", async () => {
    const { client, starts } = fakeTemporal();

    const first = await startNotification(client);
    const second = await startNotification(client);

    expect(second.firstExecutionRunId).toBe(first.firstExecutionRunId);
    expect(starts).toHaveLength(1);
  });
});

test("native ingress starts the same durable per-match workflow", async () => {
  const temporal = fakeTemporal();
  await startScoutMatchProcessingV2(temporal.client, {
    stage: "beta",
    riotMatchId: MATCH_ID,
    sourcePuuid: SOURCE_PUUID,
    deliveryMode: "live",
  });

  const [start] = temporal.starts;
  expect(start?.workflowType).toBe(SCOUT_WORKFLOW_NAMES.matchProcessingV2);
  expect(start?.options.workflowId).toBe(`scout-beta-match-v2-${MATCH_ID}`);
  expect(start?.options.workflowIdReusePolicy).toBe(
    SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.matchProcessingV2],
  );
  expect(start?.options.startDelay).toBe(SCOUT_CLIENT_MATCH_START_DELAY);
});

test("native ingress reports an already-completed workflow for binding reconciliation", async () => {
  const temporal = fakeTemporal();
  const first = await startScoutMatchProcessingV2(temporal.client, {
    stage: "beta",
    riotMatchId: MATCH_ID,
    sourcePuuid: SOURCE_PUUID,
    deliveryMode: "live",
  });
  temporal.close(`scout-beta-match-v2-${MATCH_ID}`, "completed");

  const historical = await startScoutMatchProcessingV2(temporal.client, {
    stage: "beta",
    riotMatchId: MATCH_ID,
    sourcePuuid: SOURCE_PUUID,
    deliveryMode: "live",
  });

  expect(first).not.toBeNull();
  expect(historical).toBeNull();
  expect(temporal.starts).toHaveLength(1);
});

describe("notification and projection answer reuse differently", () => {
  test("a notification re-drives after a SUCCESSFUL run", async () => {
    // The retry arm's main path: the previous execution SUCCEEDED — recording
    // `unknown-delivery` is a legitimate completion, not a failure — and the
    // operator has since resolved the ambiguity as not-delivered, releasing the
    // intent to `ready`. The fresh run computes the same deterministic ID, so a
    // policy that refused reuse after success would make the arm unusable.
    const temporal = fakeTemporal();
    const first = await startNotification(temporal.client);
    temporal.close(NOTIFICATION_ID, "completed");

    const second = await startNotification(temporal.client);

    expect(second.firstExecutionRunId).not.toBe(first.firstExecutionRunId);
    expect(temporal.starts).toHaveLength(2);
  });

  test("a projection re-runs after a FAILED run", async () => {
    const temporal = fakeTemporal();
    const first = await startProjection(temporal.client);
    temporal.close(PROJECTION_ID, "failed");

    const second = await startProjection(temporal.client);

    expect(second.firstExecutionRunId).not.toBe(first.firstExecutionRunId);
    expect(temporal.starts).toHaveLength(2);
  });

  test("a projection that SUCCEEDED is refused rather than re-run", async () => {
    // A staged projection has nothing left to do; re-running it would repeat a
    // phase the durable receipts already attest to.
    const temporal = fakeTemporal();
    await startProjection(temporal.client);
    temporal.close(PROJECTION_ID, "completed");

    await expect(startProjection(temporal.client)).rejects.toBeInstanceOf(
      WorkflowExecutionAlreadyStartedError,
    );
    expect(temporal.starts).toHaveLength(1);
  });
});

describe("operator reconciliation keeps its own reuse terms", () => {
  test("a closed operator sweep can be run again, and a running one is joined", async () => {
    // The term comes from the shared SCOUT_V2_REUSE_POLICIES table, which is
    // pinned in the temporal package's contracts test; this proves the
    // operator start sends it. It was REJECT_DUPLICATE while ScoutWorkflowStart
    // could hold one request per workflow id (SJ-205); with one row per
    // request nothing has to refuse a repeat sweep.
    const temporal = fakeTemporal();
    const first = await startScoutPipelineReconciliationV2(temporal.client, {
      stage: "beta",
      trigger: "operator",
    });
    const [start] = temporal.starts;
    expect(start?.options.workflowIdReusePolicy).toBe("ALLOW_DUPLICATE");
    expect(start?.options.workflowIdConflictPolicy).toBe("USE_EXISTING");
    expect(start?.options.workflowId).toBe(
      "scout-beta-pipeline-reconciliation-v2-operator",
    );

    // Still running: joined, not duplicated.
    const joined = await startScoutPipelineReconciliationV2(temporal.client, {
      stage: "beta",
      trigger: "operator",
    });
    expect(joined.firstExecutionRunId).toBe(first.firstExecutionRunId);
    expect(temporal.starts).toHaveLength(1);

    temporal.close(
      "scout-beta-pipeline-reconciliation-v2-operator",
      "completed",
    );

    const again = await startScoutPipelineReconciliationV2(temporal.client, {
      stage: "beta",
      trigger: "operator",
    });
    expect(again.firstExecutionRunId).not.toBe(first.firstExecutionRunId);
    expect(temporal.starts).toHaveLength(2);
  });
});
