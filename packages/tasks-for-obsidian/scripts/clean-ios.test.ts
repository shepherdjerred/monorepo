import { expect, test } from "bun:test";
import { cleanTargets } from "./ios-scripts-core.ts";

test("cleanup is scoped to iOS outputs", () => {
  expect(cleanTargets("/repo/package", "/home")).toEqual([
    "/repo/package/ios/build",
    "/repo/package/ios/Pods",
    "/home/Library/Developer/Xcode/DerivedData/TasksForObsidian-*",
  ]);
});
