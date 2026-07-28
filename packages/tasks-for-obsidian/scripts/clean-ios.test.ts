import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanTargets, derivedDataTargets } from "./ios-scripts-core.ts";

test("cleanup is scoped to iOS outputs", () => {
  expect(cleanTargets("/repo/package")).toEqual([
    "/repo/package/ios/build",
    "/repo/package/ios/Pods",
  ]);
});

test("a missing DerivedData directory has nothing to clean", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clean-ios-missing-"));
  try {
    expect(await derivedDataTargets(home)).toEqual([]);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("only this application's DerivedData directories are selected", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clean-ios-existing-"));
  const derivedData = path.join(
    home,
    "Library",
    "Developer",
    "Xcode",
    "DerivedData",
  );
  const target = path.join(derivedData, "TasksForObsidian-abc");
  try {
    await mkdir(target, { recursive: true });
    await mkdir(path.join(derivedData, "AnotherApp-abc"));
    expect(await derivedDataTargets(home)).toEqual([target]);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});
