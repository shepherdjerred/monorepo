import { describe, expect, test } from "vitest";
import { requireAuthoritativeMatchData } from "#src/league/tasks/postmatch/temporal-match-ingestion.ts";

describe("Temporal match ingestion", () => {
  test("keeps a missing authoritative match retryable", () => {
    expect(() =>
      requireAuthoritativeMatchData("NA1_UNAVAILABLE", undefined),
    ).toThrow("Authoritative match data is unavailable for NA1_UNAVAILABLE");
  });
});
