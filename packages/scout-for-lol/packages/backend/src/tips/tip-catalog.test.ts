import { describe, expect, test } from "vitest";
import {
  FEATURE_TIPS,
  parsePersistedTipKey,
  parseTipKey,
} from "#src/tips/tip-catalog.ts";

describe("persisted tip catalog", () => {
  test("every active tip is valid for presentations and impression history", () => {
    for (const { key } of FEATURE_TIPS) {
      expect(parseTipKey(key)).toBe(key);
      expect(parsePersistedTipKey(key)).toBe(key);
    }
  });

  test("recognizes retired history without enabling new presentations", () => {
    expect(parsePersistedTipKey("tournament-lobbies")).toBe(
      "tournament-lobbies",
    );
    expect(() => parseTipKey("tournament-lobbies")).toThrow(
      "Unknown persisted feature tip key",
    );
    expect(FEATURE_TIPS.map(({ key }) => key)).not.toContain(
      "tournament-lobbies",
    );
  });

  test.each([
    "not-a-real-tip",
    "tournament-lobbies ",
    " tournament-lobbies",
    "Tournament-lobbies",
    "",
  ])("still rejects an unknown persisted key: %j", (key) => {
    expect(() => parsePersistedTipKey(key)).toThrow(
      "Unknown persisted feature tip key",
    );
  });
});
