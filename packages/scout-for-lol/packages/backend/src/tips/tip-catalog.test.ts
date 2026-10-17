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

  test.each(["tournament-lobbies", "custom-nights"])(
    "recognizes retired %s history without enabling new presentations",
    (key) => {
      expect(parsePersistedTipKey(key)).toBe(key);
      expect(() => parseTipKey(key)).toThrow(
        "Unknown persisted feature tip key",
      );
      expect(FEATURE_TIPS.map((tip) => tip.key)).not.toContain(key);
    },
  );

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
