import { describe, expect, test } from "vitest";
import { scoutCompetitionTaskQueue } from "./temporal-worker.ts";

describe("Scout competition Temporal activity worker", () => {
  test("isolates beta and production dispatches on stage-specific queues", () => {
    expect(scoutCompetitionTaskQueue("beta")).toBe("scout-beta");
    expect(scoutCompetitionTaskQueue("prod")).toBe("scout-prod");
  });
});
