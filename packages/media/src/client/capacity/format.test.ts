import { expect, test } from "vitest";
import { capacityBytes } from "./format.ts";

test("capacity formatting preserves zero and exact integers beyond Number precision", () => {
  expect(capacityBytes("0")).toBe("0 bytes");
  expect(capacityBytes("9007199254740993")).toBe("9,007,199,254,740,993 bytes");
  expect(capacityBytes("9223372036854775807")).toBe(
    "9,223,372,036,854,775,807 bytes",
  );
});
