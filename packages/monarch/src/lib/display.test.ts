import { describe, expect, test } from "vitest";
import { displaySummary } from "./display.ts";
import type { EnrichmentStats } from "./enrichment/pipeline.ts";
import { emptyEnrichmentStats } from "./enrichment/pipeline.ts";

const defaultStats: EnrichmentStats = emptyEnrichmentStats();

describe("displaySummary", () => {
  test("counts changes by tier correctly", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    displaySummary({
      totalTransactions: 100,
      tier1Changes: 5,
      tier2Changes: 10,
      tier3Changes: 2,
      flagged: 0,
      enrichmentStats: {
        ...defaultStats,
        tier1Count: 20,
        tier2Count: 70,
        tier3Count: 10,
      },
    });

    console.log = originalLog;

    const changesLine = logs.find((l) => l.includes("Changes proposed"));
    expect(changesLine).toContain("17");
  });

  test("counts flagged for review", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    displaySummary({
      totalTransactions: 100,
      tier1Changes: 0,
      tier2Changes: 0,
      tier3Changes: 0,
      flagged: 3,
      enrichmentStats: defaultStats,
    });

    console.log = originalLog;

    const flagLine = logs.find((l) => l.includes("Flagged for review"));
    expect(flagLine).toContain("3");
  });

  test("shows tier distribution", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    displaySummary({
      totalTransactions: 100,
      tier1Changes: 0,
      tier2Changes: 0,
      tier3Changes: 0,
      flagged: 0,
      enrichmentStats: {
        ...defaultStats,
        tier1Count: 30,
        tier2Count: 60,
        tier3Count: 10,
      },
    });

    console.log = originalLog;

    const distLine = logs.find((l) => l.includes("Tier distribution"));
    expect(distLine).toContain("30/60/10");
  });
});
