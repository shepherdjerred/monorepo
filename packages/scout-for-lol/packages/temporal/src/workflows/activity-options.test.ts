import { describe, expect, test } from "vitest";
import { ActivityCancellationType } from "@temporalio/workflow";
import type { ScoutStage } from "#src/contracts.ts";
import { SCOUT_V2_ACTIVITY_QUEUE_CLASSES } from "#src/identifiers.ts";
import {
  BACKGROUND_ACTIVITY_OPTIONS,
  BACKGROUND_ACTIVITY_RETRY_POLICY,
  LAKE_ACTIVITY_OPTIONS,
  NOTIFICATION_DELIVERY_ACTIVITY_OPTIONS,
  REALTIME_ACTIVITY_OPTIONS,
  backgroundV2Activities,
  lakeV2Activities,
  notificationDeliveryV2Activities,
  realtimeV2Activities,
} from "./activity-options.ts";

describe("background activity retry ownership", () => {
  test("keeps four attempts for transient failures and stops quota retries", () => {
    expect(BACKGROUND_ACTIVITY_RETRY_POLICY.maximumAttempts).toBe(4);
    expect(BACKGROUND_ACTIVITY_RETRY_POLICY.nonRetryableErrorTypes).toContain(
      "ProviderQuotaExhausted",
    );
  });
});

const STAGES: readonly ScoutStage[] = ["dev", "beta", "prod"];

describe("V2 proxy factories", () => {
  test("build options the SDK accepts, for every stage", () => {
    // `proxyActivities` validates eagerly: an options set with neither a
    // start-to-close nor a schedule-to-close timeout throws here rather than
    // at the first Activity a live Workflow tries to schedule.
    for (const stage of STAGES) {
      expect(() => realtimeV2Activities(stage)).not.toThrow();
      expect(() => backgroundV2Activities(stage)).not.toThrow();
      expect(() => lakeV2Activities(stage)).not.toThrow();
      expect(() => notificationDeliveryV2Activities(stage)).not.toThrow();
    }
  });

  test("expose the V2 activity surface, not v1's", () => {
    expect(typeof realtimeV2Activities("prod").commitMatchObservationV2).toBe(
      "function",
    );
    expect(
      typeof backgroundV2Activities("prod").scanPipelineReconciliationPageV2,
    ).toBe("function");
    expect(typeof lakeV2Activities("prod").stageLakeProjectionV2).toBe(
      "function",
    );
    expect(
      typeof notificationDeliveryV2Activities("prod").deliverNotificationV2,
    ).toBe("function");
  });

  test("cover every queue class a V2 activity declares", () => {
    // A V2 Activity assigned to a class with no factory would have nothing to
    // dispatch it, and `interactive` in particular must stay uncovered: that
    // queue serves a human waiting on a turn.
    const factoriesByQueueClass = {
      realtime: realtimeV2Activities,
      background: backgroundV2Activities,
      lake: lakeV2Activities,
    };
    for (const queueClass of new Set(
      Object.values(SCOUT_V2_ACTIVITY_QUEUE_CLASSES),
    )) {
      expect(factoriesByQueueClass).toHaveProperty(queueClass);
    }
  });
});

describe("frozen V2 activity budgets", () => {
  test("never retries a notification send", () => {
    // The request may have posted to Discord before the response was lost, so
    // a second attempt can double-deliver to a user. One attempt makes an
    // ambiguous send terminate, which the Workflow records as
    // `unknown-delivery` against that attempt's nonce.
    expect(NOTIFICATION_DELIVERY_ACTIVITY_OPTIONS.retry.maximumAttempts).toBe(
      1,
    );
  });

  test("waits out a cancelled send rather than abandoning its outcome", () => {
    expect(NOTIFICATION_DELIVERY_ACTIVITY_OPTIONS.cancellationType).toBe(
      ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    );
  });

  test("gives delivery Discord's budget, not the shared realtime one", () => {
    // A send that has not answered in 30 seconds is already ambiguous;
    // waiting out the realtime window only widens the window in which the
    // Workflow cannot say what happened.
    expect(NOTIFICATION_DELIVERY_ACTIVITY_OPTIONS.startToCloseTimeout).toBe(
      "30 seconds",
    );
    expect(NOTIFICATION_DELIVERY_ACTIVITY_OPTIONS.scheduleToCloseTimeout).toBe(
      "2 minutes",
    );
    expect(
      NOTIFICATION_DELIVERY_ACTIVITY_OPTIONS.scheduleToCloseTimeout,
    ).not.toBe(REALTIME_ACTIVITY_OPTIONS.scheduleToCloseTimeout);
  });

  test("heartbeats lake staging through long projections", () => {
    expect(LAKE_ACTIVITY_OPTIONS.heartbeatTimeout).toBe("30 seconds");
    expect(LAKE_ACTIVITY_OPTIONS.startToCloseTimeout).toBe("2 hours");
    expect(LAKE_ACTIVITY_OPTIONS.scheduleToCloseTimeout).toBe("6 hours");
  });

  test("spends the same budget on V2 background work as on detached v1 work", () => {
    // Identity, not equality: one object, so the two cannot drift apart.
    expect(BACKGROUND_ACTIVITY_OPTIONS.retry).toBe(
      BACKGROUND_ACTIVITY_RETRY_POLICY,
    );
  });

  test("keeps realtime latency-shaped for both pipelines", () => {
    expect(REALTIME_ACTIVITY_OPTIONS.startToCloseTimeout).toBe("90 seconds");
    expect(REALTIME_ACTIVITY_OPTIONS.retry.maximumAttempts).toBe(5);
  });
});
