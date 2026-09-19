import { describe, expect, test } from "vitest";
import { notificationDeliveryDecision } from "#src/recovery/delivery-policy.ts";

/**
 * The whole table, because the table IS the contract: every recovery policy
 * crossed with every target kind, and the one cell where the two disagree —
 * a stale-private-only batch reaching a channel — is the cell the policy
 * exists for.
 */
describe("notificationDeliveryDecision", () => {
  test.each([
    { policy: "normal", target: "channel", decision: "permitted" },
    { policy: "normal", target: "dm", decision: "permitted" },
    { policy: "stale-private-only", target: "dm", decision: "permitted" },
    { policy: "stale-private-only", target: "channel", decision: "held" },
    { policy: "no-external", target: "channel", decision: "held" },
    { policy: "no-external", target: "dm", decision: "held" },
  ] as const)(
    "$policy to a $target target is $decision",
    ({ policy, target, decision }) => {
      expect(notificationDeliveryDecision(policy, target)).toBe(decision);
    },
  );

  test("a release from no-external to stale-private-only frees exactly the private targets", () => {
    // The operator release is the only sanctioned policy change, and this is
    // what it means for the intents born of the batch: DMs proceed, channels
    // stay held, because nothing ever releases a batch to `normal`.
    expect(notificationDeliveryDecision("no-external", "dm")).toBe("held");
    expect(notificationDeliveryDecision("stale-private-only", "dm")).toBe(
      "permitted",
    );
    expect(notificationDeliveryDecision("stale-private-only", "channel")).toBe(
      "held",
    );
  });
});
