import { expect, test } from "vitest";
import { conformanceProblems } from "@shepherdjerred/console-ui/testing";

test("follows the console-ui vocabulary", async () => {
  expect(await conformanceProblems(import.meta.dirname)).toEqual([]);
});
