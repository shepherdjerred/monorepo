import { describe, expect, test } from "bun:test";
import {
  formatParlayCustomId,
  isParlayCustomId,
  parseParlayCustomId,
} from "#src/betting/parlay-custom-id.ts";

describe("parlay custom IDs", () => {
  test("round trips the versioned format", () => {
    const input = {
      action: "b" as const,
      matchId: "NA1_123",
      side: "NO" as const,
      amount: 5,
    };
    expect(parseParlayCustomId(formatParlayCustomId(input))).toEqual(input);
  });

  test("claims malformed namespaced IDs without parsing them", () => {
    expect(isParlayCustomId("bbp:old")).toBeTrue();
    expect(parseParlayCustomId("bbp:old")).toBeUndefined();
  });
});
