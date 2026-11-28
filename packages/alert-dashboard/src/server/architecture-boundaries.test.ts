import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  assertArchitectureFixtures,
  expectedFixtureRuleNames,
} from "@shepherdjerred/architecture";
import { expect, test } from "vitest";
import architecture, { MODULE_IDS, moduleBoundaries } from "#architecture";

const packageRoot = path.resolve(import.meta.dir, "../..");

test("architecture fixtures prove every alert-dashboard boundary", async () => {
  await assertArchitectureFixtures({
    packageRoot,
    definition: architecture,
  });
});

test("every module directory on disk has a declared boundary", async () => {
  const entries = await readdir(path.join(packageRoot, "src/modules"), {
    withFileTypes: true,
  });
  const onDisk = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  expect([...MODULE_IDS].sort()).toEqual(onDisk.sort());
});

test("module boundaries isolate each module and pass the checker's validation", () => {
  const boundaries = moduleBoundaries(["notes", "journal"]);

  expect(boundaries.map(({ from, to }) => ({ from, to }))).toEqual([
    {
      from: "modules/notes",
      to: ["domain", "application", "infrastructure", "modules/journal"],
    },
    {
      from: "modules/journal",
      to: ["domain", "application", "infrastructure", "modules/notes"],
    },
  ]);
  expect(expectedFixtureRuleNames({ boundaries })).toEqual([
    "negative-module-journal-is-self-contained",
    "negative-module-notes-is-self-contained",
  ]);
});
