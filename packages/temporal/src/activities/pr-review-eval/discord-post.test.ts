import { describe, expect, it } from "bun:test";
import { buildEmbed } from "./discord-post.ts";
import type { SignificanceReport } from "./significance.ts";

const baseReport: Omit<SignificanceReport, "verdict"> = {
  experimentId: "test-exp",
  windowStartedAt: new Date("2026-04-01T00:00:00Z"),
  windowEndedAt: new Date("2026-05-01T00:00:00Z"),
  totalLabeled: 100,
  arms: [
    {
      variant: "control",
      labeledCount: 50,
      accepts: 25,
      dismisses: 25,
      posteriorMean: 0.5,
      ci95Low: 0.36,
      ci95High: 0.64,
    },
    {
      variant: "treatment",
      labeledCount: 50,
      accepts: 40,
      dismisses: 10,
      posteriorMean: 0.788,
      ci95Low: 0.65,
      ci95High: 0.89,
    },
  ],
  pairwiseProbabilities: [],
};

describe("buildEmbed", () => {
  it("uses green color + winner description for winner-ready verdicts", () => {
    const embed = buildEmbed({
      ...baseReport,
      verdict: {
        kind: "winner-ready",
        winner: "treatment",
        probabilityWinning: 0.97,
      },
    });
    expect(embed.color).toBe(0x2e_cc_71);
    expect(embed.description).toContain("treatment");
    expect(embed.description).toContain("97.0%");
  });

  it("uses amber color for inconclusive verdicts", () => {
    const embed = buildEmbed({
      ...baseReport,
      verdict: { kind: "inconclusive" },
    });
    expect(embed.color).toBe(0xf1_c4_0f);
    expect(embed.description).toContain("Inconclusive");
  });

  it("uses grey color for insufficient-data verdicts", () => {
    const embed = buildEmbed({
      ...baseReport,
      verdict: { kind: "insufficient-data", minLabeledRequired: 30 },
    });
    expect(embed.color).toBe(0x95_a5_a6);
    expect(embed.description).toContain("Insufficient");
    expect(embed.description).toContain("30");
  });

  it("includes one field per arm with formatted counters", () => {
    const embed = buildEmbed({
      ...baseReport,
      verdict: { kind: "inconclusive" },
    });
    expect(embed.fields).toHaveLength(2);
    const control = embed.fields.find((f) => f.name.includes("control"));
    expect(control?.value).toContain("labeled: **50**");
    expect(control?.value).toContain("accepts: 25");
    expect(control?.value).toContain("posterior mean: 50.0%");
  });

  it("renders the window dates in the footer", () => {
    const embed = buildEmbed({
      ...baseReport,
      verdict: { kind: "inconclusive" },
    });
    expect(embed.footer?.text).toContain("2026-04-01");
    expect(embed.footer?.text).toContain("2026-05-01");
    expect(embed.footer?.text).toContain("total labeled: 100");
  });
});
