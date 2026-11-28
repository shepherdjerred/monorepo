import { expect, test } from "vitest";
import { conformanceProblems } from "@shepherdjerred/console-ui/testing";

// console-ui's per-app scan; conformance-allowlist.json may only shrink.
test("follows the console-ui vocabulary", async () => {
  expect(
    await conformanceProblems(import.meta.dirname, {
      also: ["../styles", "../modules", "../components"],
    }),
  ).toEqual([]);
});
