import { describe, expect, test } from "vitest";
import { CONSUMER_PREVIEW } from "./consumer-previews.ts";

describe("consumer preview snapshot", () => {
  test("contains only reviewed presentation data", () => {
    const serialized = JSON.stringify(CONSUMER_PREVIEW);

    expect(CONSUMER_PREVIEW.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(serialized).not.toMatch(/\b\d{17,20}\b/);
    expect(serialized).not.toMatch(
      /discordId|creator|subscription|permission|guildId/i,
    );
  });
});
