import { describe, expect, test } from "vitest";
import {
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
