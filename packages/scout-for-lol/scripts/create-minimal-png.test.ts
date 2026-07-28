import { expect, test } from "bun:test";
import { minimalPng, scoutIconDirectory } from "./migration-core.ts";

test("emits a PNG signature", () => {
  expect(minimalPng().slice(0, 8)).toEqual(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  );
});

test("writes icons relative to the Scout package root", () => {
  expect(scoutIconDirectory("/repo/packages/scout-for-lol/scripts")).toBe(
    "/repo/packages/scout-for-lol/packages/desktop/src-tauri/icons",
  );
  expect(() => scoutIconDirectory("/repo/scripts-other")).toThrow(
    "Expected Scout scripts directory",
  );
});
