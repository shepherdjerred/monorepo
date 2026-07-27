import { expect, test } from "bun:test";
import { minimalPng } from "./migration-core.ts";

test("emits a PNG signature", () => {
  expect(minimalPng().slice(0, 8)).toEqual(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  );
});
