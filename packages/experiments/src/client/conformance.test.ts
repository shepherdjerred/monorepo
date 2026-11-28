import { conformanceProblems } from "@shepherdjerred/console-ui/testing";
import { expect, test } from "vitest";

test("follows the console-ui vocabulary", async () => {
  expect(
    await conformanceProblems(import.meta.dirname, { also: ["../browser"] }),
  ).toEqual([]);
});
