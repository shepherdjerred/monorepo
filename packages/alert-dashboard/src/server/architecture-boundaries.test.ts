import {
  assertArchitectureFixtures,
  expectedFixtureRuleNames,
} from "@shepherdjerred/architecture";
import { expect, test } from "vitest";
import architecture, { MODULE_IDS, moduleBoundaries } from "#architecture";

const packageRoot = import.meta.dir.replace(/\/src\/server$/u, "");

test("architecture fixtures prove every alert-dashboard boundary", async () => {
  await assertArchitectureFixtures({
    packageRoot,
    definition: architecture,
  });
});

test("every module directory on disk has a declared boundary", async () => {
  const onDisk = new Set<string>();
  const files = new Bun.Glob("modules/*/**").scan({
    cwd: `${packageRoot}/src`,
  });
  for await (const file of files) onDisk.add(file.split("/")[1] ?? "");

  expect([...MODULE_IDS].sort()).toEqual([...onDisk].sort());
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
