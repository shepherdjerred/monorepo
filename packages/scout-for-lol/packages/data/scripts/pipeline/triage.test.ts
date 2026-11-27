import { describe, expect, test } from "vitest";
import { asksAboutInteraction, routeOf } from "./triage.ts";

const THRESHOLDS = { lo: 0.15, hi: 0.85 };

describe("triage routing", () => {
  test("keeps a tip that is confidently correct and asserts no interaction", () => {
    expect(
      routeOf(0.05, "Poke with Orb of Deception from range.", THRESHOLDS),
    ).toBe("keep");
  });

  test("repairs a tip that is confidently wrong", () => {
    expect(
      routeOf(0.9, "Poke with Orb of Deception from range.", THRESHOLDS),
    ).toBe("repair");
  });

  test("escalates a tip between the thresholds", () => {
    expect(
      routeOf(0.4, "Poke with Orb of Deception from range.", THRESHOLDS),
    ).toBe("escalate");
  });

  test("escalates a tip that asserts an interaction even when it looks correct", () => {
    for (const text of [
      "Her wall blocks his dash.",
      "Interrupt the channel with your stun.",
      "Fox-Fire reveals her in the smoke.",
      "The orb collides with the first minion.",
      "Cancel the animation with a dash.",
      "Stops her from moving.",
    ]) {
      expect(asksAboutInteraction(text)).toBe(true);
      expect(routeOf(0.01, text, THRESHOLDS)).toBe("escalate");
    }
    expect(asksAboutInteraction("Back off when your mana is low.")).toBe(false);
  });
});
