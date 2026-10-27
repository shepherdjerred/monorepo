import { ScoutNotificationGateSchema } from "#src/activity-contracts.ts";
import { NotificationIntentKindSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import { expect, test } from "vitest";

test("the active notification domain excludes a kind retained only in Workflow history", () => {
  expect(NotificationIntentKindSchema.safeParse("settlement").success).toBe(
    false,
  );
  const recordedGate = {
    kind: "settlement",
    target: "channel",
    policy: "normal",
    decision: "permitted",
  };
  expect(ScoutNotificationGateSchema.parse(recordedGate)).toEqual(recordedGate);
});
