import { describe, expect, test } from "vitest";
import committed from "#champion-meta-snapshot";
import { parseChampionMetaSnapshot } from "#src/lib/champion-meta/snapshot.ts";

describe("committed snapshot", () => {
  test("parses, and only ever holds what the meta API returned", () => {
    const snapshot = parseChampionMetaSnapshot(committed);
    if (snapshot.champions.length === 0) {
      expect(snapshot.source).toBeNull();
    } else {
      expect(snapshot.source?.buildId).not.toBe("fixture");
    }
  });
});
