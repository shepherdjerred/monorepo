import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  cruiseArchitectureFixtures,
  expectedFixtureRuleNames,
} from "@shepherdjerred/architecture";
import architecture, { layers } from "#architecture";

const packageRoot = import.meta.dir.replace(/\/src$/u, "");

/** Layer-eligible entries of a directory: sub-directories and non-test `.ts` modules. */
async function entries(directory: string): Promise<string[]> {
  const found = await readdir(`${packageRoot}/${directory}`, {
    withFileTypes: true,
  });
  return found
    .filter(
      (entry) =>
        !entry.name.startsWith("__") &&
        (entry.isDirectory() ||
          (entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".test.ts") &&
            !entry.name.endsWith(".d.ts"))),
    )
    .map((entry) => entry.name.replace(/\.ts$/u, ""));
}

async function directories(directory: string): Promise<string[]> {
  const found = await readdir(`${packageRoot}/${directory}`, {
    withFileTypes: true,
  });
  return found
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("__"))
    .map((entry) => entry.name);
}

describe("dependency-cruiser layer boundaries", () => {
  it("declares exactly the modules and directories under src/ as layers", async () => {
    // `dataDragon` is camelCase and so cannot be a layer name; `html` is
    // listed by its subdirectories, since its root modules are entry points.
    const srcEntries = await entries("src");
    const topLevel = srcEntries.filter(
      (name) => !["index", "html", "dataDragon"].includes(name),
    );
    const htmlDirectories = await directories("src/html");
    const html = htmlDirectories.map((name) => `html/${name}`);

    expect([...layers].sort()).toEqual([...topLevel, ...html].sort());
  });

  it("rejects a committed negative fixture for every declared boundary", async () => {
    const result = await cruiseArchitectureFixtures({
      packageRoot,
      definition: architecture,
    });

    expect(result.violatedRuleNames).toEqual(
      expectedFixtureRuleNames(architecture),
    );
    expect(result.errorCount).toBe(result.fixtureFiles.length);
  });
});
