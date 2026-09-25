import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import { intentRecord } from "#src/temporal/v2/notification-delivery.test-fixtures.ts";

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
  requireIntentRecordV2: vi.fn(),
  afterDareSummaryDeliveredV2: vi.fn(),
  afterPrematchDeliveredV2: vi.fn(),
}));

vi.mock("#src/temporal/v2/notification-reads.ts", () => ({
  requireIntentRecordV2: stubs.requireIntentRecordV2,
}));
vi.mock("#src/temporal/v2/notification/dare-summary-notification.ts", () => ({
  afterDareSummaryDeliveredV2: stubs.afterDareSummaryDeliveredV2,
}));
vi.mock("#src/temporal/v2/notification/prematch-follow-up.ts", () => ({
  afterPrematchDeliveredV2: stubs.afterPrematchDeliveredV2,
}));

const { afterNotificationDeliveredV2 } =
  await import("#src/temporal/v2/notification/notification-follow-up.ts");

const ATTEMPT = {
  stage: "dev",
  intentKey: NotificationIntentKeySchema.parse(
    "dare-summary-discord:NA1_9301:100000000000000001",
  ),
  attemptNonce: NotificationAttemptNonceSchema.parse("attempt-nonce-1"),
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  stubs.requireIntentRecordV2.mockResolvedValue(
    intentRecord("channel", "dare-summary"),
  );
  stubs.afterDareSummaryDeliveredV2.mockResolvedValue(undefined);
});

describe("the post-delivery follow-up", () => {
  test("refreshes the Dare callout for a dare-summary intent", async () => {
    const result = await afterNotificationDeliveredV2(ATTEMPT);

    expect(result).toEqual({ outcome: "completed" });
    expect(stubs.afterDareSummaryDeliveredV2).toHaveBeenCalledTimes(1);
  });

  test("hands a delivered prematch to its own follow-up and lets it throw", async () => {
    // The prematch step records the Bryan Bucks message ref, the settlement
    // announcement's only destination; a failure must reach the Activity's
    // retry rather than be reported and dropped.
    stubs.requireIntentRecordV2.mockResolvedValue(
      intentRecord("channel", "prematch"),
    );
    stubs.afterPrematchDeliveredV2.mockResolvedValueOnce({
      outcome: "completed",
    });
    expect(await afterNotificationDeliveredV2(ATTEMPT)).toEqual({
      outcome: "completed",
    });

    stubs.afterPrematchDeliveredV2.mockRejectedValueOnce(
      new Error("the ref write was lost"),
    );
    await expect(afterNotificationDeliveredV2(ATTEMPT)).rejects.toThrow(
      "the ref write was lost",
    );
    expect(stubs.afterDareSummaryDeliveredV2).not.toHaveBeenCalled();
  });

  test.each(["postmatch", "settlement"] as const)(
    "has nothing to do for a %s intent",
    async (kind) => {
      stubs.requireIntentRecordV2.mockResolvedValue(
        intentRecord("channel", kind),
      );

      expect(await afterNotificationDeliveredV2(ATTEMPT)).toEqual({
        outcome: "skipped",
      });
      expect(stubs.afterDareSummaryDeliveredV2).not.toHaveBeenCalled();
    },
  );

  test("reports a refresh that failed instead of throwing it", async () => {
    // A throw here would fail the Activity, and a best-effort edit is not a
    // reason to retry or to fail anything: the delivery it follows is already
    // recorded.
    stubs.afterDareSummaryDeliveredV2.mockRejectedValue(
      new Error("the edit was refused"),
    );

    expect(await afterNotificationDeliveredV2(ATTEMPT)).toEqual({
      outcome: "failed",
    });
  });
});
