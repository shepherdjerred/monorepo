import { describe, expect, test } from "vitest";
import { loadClashChrome } from "./chrome.ts";

describe("loadClashChrome", () => {
  test("skips non-Clash queues without reading the snapshot", async () => {
    expect(
      await loadClashChrome({
        queueType: "solo",
        participants: [{ puuid: null, team: "blue" }],
      }),
    ).toBeUndefined();
  });

  test("returns empty chrome when a Clash lobby has no puuids", async () => {
    expect(
      await loadClashChrome({
        queueType: "clash",
        participants: [{ puuid: null, team: "blue" }],
      }),
    ).toEqual({});
  });
});
