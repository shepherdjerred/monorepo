import {
  DARE_CALLOUT_MAX_LENGTH,
  dareCalloutContent,
  renderDareResult,
  type DareCalloutInput,
} from "#src/dares/presentation/dare-callout-content.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { expect, test } from "vitest";
const actor = DiscordAccountIdSchema.parse("200000000000000001");
function callout(): DareCalloutInput {
  return {
    id: 42,
    challengerDiscordId: actor,
    targetAliases: ["Virmel"],
    revision: 1,
    plainLanguage: "Win one game on Twisted Fate",
    evidenceCount: 0,
    progressSummary: "No games yet",
    state: "pending_accept",
    targets: [{ alias: "Virmel", acceptedAt: null, declinedAt: null }],
    acceptDeadline: new Date("2026-10-27T00:00:00Z"),
    deadlineAt: null,
    finalValue: null,
    voidReason: null,
  };
}
test("a free Dare shows its contract, consent and evidence", () => {
  const content = dareCalloutContent(callout());
  expect(content).toContain("Scout Dare #42");
  expect(content).toContain("Virmel: waiting");
  expect(content).toContain("0 evidence games");
  expect(content).not.toMatch(/BB|stake|pot|payout|contribut/i);
});
test("a callout fails authoring validation when its rendered copy exceeds Discord's budget", () => {
  expect(() =>
    dareCalloutContent({ ...callout(), plainLanguage: "x".repeat(2000) }),
  ).toThrow("content limit");
});
test.each(["achieved", "unachieved", "voided"] as const)(
  "a %s result fits the message budget",
  (resolution) => {
    const result = renderDareResult(42, {
      resolution,
      challengerDiscordId: actor,
      plainLanguage: "🎯".repeat(2000),
      winners:
        resolution === "achieved"
          ? [{ discordId: actor, alias: "Virmel" }]
          : [],
      voidReason: resolution === "voided" ? "missing_evidence" : null,
    });
    expect(result.content.length).toBeLessThanOrEqual(DARE_CALLOUT_MAX_LENGTH);
    expect(result.mentionUserIds).toEqual(
      resolution === "achieved" ? [actor] : [],
    );
    expect(result.content).not.toMatch(/BB|payout|refund/);
  },
);
test("winner names are escaped and mentions are deduplicated", () => {
  const result = renderDareResult(42, {
    resolution: "achieved",
    challengerDiscordId: actor,
    plainLanguage: "Win",
    winners: [
      { discordId: actor, alias: "**everyone**" },
      { discordId: actor, alias: "second" },
    ],
    voidReason: null,
  });
  expect(result.content).toContain(String.raw`\*\*everyone\*\*`);
  expect(result.mentionUserIds).toEqual([actor]);
});
