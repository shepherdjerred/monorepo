import { describe, expect, test } from "vitest";
import {
  ScoutCrawlFrontierPruneBatchResultSchema,
  ScoutCrawlFrontierPruneInputSchema,
  ScoutCrawlFrontierPruneResultSchema,
  ScoutParticipantCrawlInputSchema,
  ScoutParticipantCrawlResultSchema,
} from "./contracts.ts";
import { SCOUT_WORKFLOW_NAMES, scoutTaskQueues } from "./identifiers.ts";
import * as workflows from "./workflows/index.ts";

describe("participant crawl contracts", () => {
  test("runs on its own stage-scoped Activity queue", () => {
    expect(scoutTaskQueues("beta").crawl).toBe("scout-beta-crawl");
    expect(scoutTaskQueues("prod").crawl).toBe("scout-prod-crawl");
  });

  test("names a Workflow type the bundle exports", () => {
    expect(SCOUT_WORKFLOW_NAMES.participantCrawl).toBe(
      "scoutParticipantCrawlWorkflow",
    );
    expect(Object.keys(workflows)).toContain("scoutParticipantCrawlWorkflow");
  });

  test("accepts only the scheduled trigger", () => {
    expect(
      ScoutParticipantCrawlInputSchema.parse({
        stage: "beta",
        trigger: "schedule",
      }),
    ).toEqual({ stage: "beta", trigger: "schedule" });
    expect(() =>
      ScoutParticipantCrawlInputSchema.parse({
        stage: "beta",
        trigger: "manual",
      }),
    ).toThrow();
    expect(() =>
      ScoutParticipantCrawlInputSchema.parse({
        stage: "beta",
        trigger: "schedule",
        puuid: "x",
      }),
    ).toThrow();
  });

  test("the frontier prune names a Workflow type the bundle exports and takes only the scheduled trigger", () => {
    expect(SCOUT_WORKFLOW_NAMES.crawlFrontierPrune).toBe(
      "scoutCrawlFrontierPruneWorkflow",
    );
    expect(Object.keys(workflows)).toContain("scoutCrawlFrontierPruneWorkflow");
    expect(
      ScoutCrawlFrontierPruneInputSchema.parse({
        stage: "beta",
        trigger: "schedule",
      }),
    ).toEqual({ stage: "beta", trigger: "schedule" });
    expect(() =>
      ScoutCrawlFrontierPruneInputSchema.parse({
        stage: "beta",
        trigger: "manual",
      }),
    ).toThrow();
  });

  test("the frontier prune results carry counts, never identifiers", () => {
    const batch = { stale: 3, overflow: 4, more: false };
    expect(ScoutCrawlFrontierPruneBatchResultSchema.parse(batch)).toEqual(
      batch,
    );
    expect(() =>
      ScoutCrawlFrontierPruneBatchResultSchema.parse({ ...batch, puuids: [] }),
    ).toThrow();
    const run = { batches: 1, stale: 3, overflow: 4, drained: true };
    expect(ScoutCrawlFrontierPruneResultSchema.parse(run)).toEqual(run);
    expect(() =>
      ScoutCrawlFrontierPruneResultSchema.parse({ ...run, batches: 0 }),
    ).toThrow();
  });

  test("a result carries counts, never identifiers", () => {
    const result = {
      status: "completed",
      seededObservations: 1,
      admittedPlayers: 10,
      playersVisited: 2,
      matchesStored: 5,
      segmentsWritten: 1,
    };
    expect(ScoutParticipantCrawlResultSchema.parse(result)).toEqual(result);
    expect(() =>
      ScoutParticipantCrawlResultSchema.parse({ ...result, matchIds: [] }),
    ).toThrow();
  });
});
