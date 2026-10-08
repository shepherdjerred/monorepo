import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import { intentRecord } from "#src/temporal/notification-lane/notification-delivery.test-fixtures.ts";

/**
 * The post-delivery follow-up, now that it is an Activity of its own.
 *
 * It runs only after the delivery outcome is durably recorded, so nothing it
 * does can change what was delivered. What it must therefore never do is
 * THROW its way into the delivery's business: inside the send Activity a
 * refresh that outlived the heartbeat timeout took an answered send down with
 * it, and the Workflow recorded a message Discord had accepted as ambiguous.
 * Out here a failure is a return value.
 */

const stubs = vi.hoisted(() => ({
  requireIntentRecord: vi.fn(),
  afterDareStatusDelivered: vi.fn(),
  afterPrematchDelivered: vi.fn(),
  afterPostmatchDelivered: vi.fn(),
  afterHallRecordBreakDelivered: vi.fn(),
  confirmNotificationTip: vi.fn(async () => {
    /* The presentation suite verifies claims. */
  }),
}));
vi.mock("#src/temporal/notification/notification-presentation.ts", () => ({
  confirmNotificationTip: stubs.confirmNotificationTip,
}));

vi.mock("#src/temporal/notification-lane/notification-reads.ts", () => ({
  requireIntentRecord: stubs.requireIntentRecord,
}));
vi.mock("#src/temporal/notification/dare-status-notification.ts", () => ({
  afterDareStatusDelivered: stubs.afterDareStatusDelivered,
}));
vi.mock("#src/temporal/notification/prematch-follow-up.ts", () => ({
  afterPrematchDelivered: stubs.afterPrematchDelivered,
}));
vi.mock("#src/temporal/notification/postmatch-follow-up.ts", () => ({
  afterPostmatchDelivered: stubs.afterPostmatchDelivered,
}));
vi.mock("#src/temporal/notification/hall-record-break-notification.ts", () => ({
  afterHallRecordBreakDelivered: stubs.afterHallRecordBreakDelivered,
}));

const { afterNotificationDelivered } =
  await import("#src/temporal/notification/notification-follow-up.ts");

const ATTEMPT = {
  stage: "dev",
  intentKey: NotificationIntentKeySchema.parse("dare-result:9301:revision:1"),
  attemptNonce: NotificationAttemptNonceSchema.parse("attempt-nonce-1"),
} as const;

/** A Dare's public result post: a Dare subject delivered to a channel. */
const DARE_RESULT_RECORD = { dareId: 9301, intent: { kind: "dare-status" } };

beforeEach(() => {
  vi.clearAllMocks();
  stubs.requireIntentRecord.mockResolvedValue(DARE_RESULT_RECORD);
  stubs.afterDareStatusDelivered.mockResolvedValue("refreshed");
});

describe("the post-delivery follow-up", () => {
  test("refreshes the Dare callout after a Dare result post", async () => {
    const result = await afterNotificationDelivered(ATTEMPT);

    expect(result).toEqual({ outcome: "completed" });
    expect(stubs.afterDareStatusDelivered).toHaveBeenCalledWith(
      DARE_RESULT_RECORD,
    );
  });

  test("has nothing to do after a Dare DM", async () => {
    stubs.afterDareStatusDelivered.mockResolvedValue("skipped");

    expect(await afterNotificationDelivered(ATTEMPT)).toEqual({
      outcome: "skipped",
    });
  });

  test("hands a delivered prematch to its own follow-up and lets it throw", async () => {
    // The prematch step records the Bryan Bucks message ref, the settlement
    // announcement's only destination; a failure must reach the Activity's
    // retry rather than be reported and dropped.
    stubs.requireIntentRecord.mockResolvedValue(
      intentRecord("channel", "prematch"),
    );
    stubs.afterPrematchDelivered.mockResolvedValueOnce({
      outcome: "completed",
    });
    expect(await afterNotificationDelivered(ATTEMPT)).toEqual({
      outcome: "completed",
    });

    stubs.afterPrematchDelivered.mockRejectedValueOnce(
      new Error("the ref write was lost"),
    );
    await expect(afterNotificationDelivered(ATTEMPT)).rejects.toThrow(
      "the ref write was lost",
    );
    expect(stubs.afterDareStatusDelivered).not.toHaveBeenCalled();
  });

  test("counts a delivered post-match report's core output, and reports its failure", async () => {
    // v1 counted the guilds its report reached; V2 delivers per channel, so
    // the follow-up is where that analytics event is recorded now.
    stubs.requireIntentRecord.mockResolvedValue(
      intentRecord("channel", "postmatch"),
    );
    stubs.afterPostmatchDelivered.mockResolvedValueOnce(undefined);
    expect(await afterNotificationDelivered(ATTEMPT)).toEqual({
      outcome: "completed",
    });
    expect(stubs.afterPostmatchDelivered).toHaveBeenCalledTimes(1);
    expect(stubs.confirmNotificationTip).toHaveBeenCalledTimes(1);

    // Analytics are not a reason to fail an answered send.
    stubs.afterPostmatchDelivered.mockRejectedValueOnce(
      new Error("posthog was unreachable"),
    );
    expect(await afterNotificationDelivered(ATTEMPT)).toEqual({
      outcome: "failed",
    });
    expect(stubs.afterPrematchDelivered).not.toHaveBeenCalled();
  });

  test.each(["settlement"] as const)(
    "has nothing to do for a %s intent",
    async (kind) => {
      stubs.requireIntentRecord.mockResolvedValue(
        intentRecord("channel", kind),
      );

      expect(await afterNotificationDelivered(ATTEMPT)).toEqual({
        outcome: "skipped",
      });
      expect(stubs.afterDareStatusDelivered).not.toHaveBeenCalled();
    },
  );

  test("runs the hall bookkeeping after a delivered record break, and reports its failure", async () => {
    stubs.requireIntentRecord.mockResolvedValue(
      intentRecord("channel", "hall-record-break"),
    );
    stubs.afterHallRecordBreakDelivered.mockResolvedValueOnce(undefined);
    expect(await afterNotificationDelivered(ATTEMPT)).toEqual({
      outcome: "completed",
    });

    // Analytics and a counter are not a reason to fail an answered send.
    stubs.afterHallRecordBreakDelivered.mockRejectedValueOnce(
      new Error("posthog was unreachable"),
    );
    expect(await afterNotificationDelivered(ATTEMPT)).toEqual({
      outcome: "failed",
    });
    expect(stubs.afterDareStatusDelivered).not.toHaveBeenCalled();
  });

  test("reports a refresh that failed instead of throwing it", async () => {
    // A throw here would fail the Activity, and a best-effort edit is not a
    // reason to retry or to fail anything: the delivery it follows is already
    // recorded.
    stubs.afterDareStatusDelivered.mockRejectedValue(
      new Error("the edit was refused"),
    );

    expect(await afterNotificationDelivered(ATTEMPT)).toEqual({
      outcome: "failed",
    });
  });
});
