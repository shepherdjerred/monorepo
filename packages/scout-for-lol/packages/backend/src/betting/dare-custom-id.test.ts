import { describe, expect, test } from "vitest";
import { BUCKS_INT32_MAX } from "@scout-for-lol/data";
import { MAX_CUSTOM_ID_LENGTH } from "#src/betting/custom-id.ts";
import {
  formatDareCustomId,
  isDareCustomId,
  parseDareCustomId,
} from "#src/betting/dare-custom-id.ts";

describe("dare custom IDs", () => {
  test("round trips every plain action", () => {
    for (const action of ["c", "n", "a", "d"] as const) {
      const input = { action, dareId: 42 };
      expect(parseDareCustomId(formatDareCustomId(input))).toEqual(input);
    }
  });

  test("round trips contributions including the amount", () => {
    const input = { action: "p" as const, dareId: 7, amount: 5 };
    expect(formatDareCustomId(input)).toBe("bbd:1:p:7:5");
    expect(parseDareCustomId("bbd:1:p:7:5")).toEqual(input);
  });

  test("pins the exact wire format for plain actions", () => {
    expect(formatDareCustomId({ action: "c", dareId: 123 })).toBe(
      "bbd:1:c:123",
    );
  });

  test("never throws on garbage and rejects malformed IDs", () => {
    const garbage = [
      "",
      "bbd",
      "bbd:",
      "bbd:1",
      "bbd:1:c",
      "bbd:1:c:",
      "bbd:1:c:abc",
      "bbd:1:c:0",
      "bbd:1:c:-4",
      "bbd:1:c:4.5",
      "bbd:1:z:4",
      "bbd:2:c:4",
      "bbd:1:c:4:9",
      "bbd:1:p:4",
      "bbd:1:p:4:0",
      "bbd:1:p:4:abc",
      "bbd:1:p:4:5:6",
      "bbd:1:p:4:2147483648",
      "🎯🎯🎯",
      ":::",
    ];
    for (const raw of garbage) {
      expect(parseDareCustomId(raw)).toBeUndefined();
    }
  });

  test("rejects foreign namespaces without claiming them", () => {
    for (const raw of [
      "bb:1:b:NA1_1:0:W:5",
      "bbp:1:b:NA1_1:Y:5",
      "bbw:1:b:9:Y:1",
      "bbnav:1:h:1:2:3",
      "scout:1:publish:a:b",
    ]) {
      expect(parseDareCustomId(raw)).toBeUndefined();
      expect(isDareCustomId(raw)).toBe(false);
    }
  });

  test("claims malformed namespaced IDs without parsing them", () => {
    expect(isDareCustomId("bbd:old")).toBe(true);
    expect(parseDareCustomId("bbd:old")).toBeUndefined();
  });

  test("stays under Discord's length cap at the widest legal values", () => {
    const id = formatDareCustomId({
      action: "p",
      dareId: BUCKS_INT32_MAX,
      amount: BUCKS_INT32_MAX,
    });
    expect(id.length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
    expect(id).toBe("bbd:1:p:2147483647:2147483647");
  });
});
