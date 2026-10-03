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

describe("dependency-cruiser layer boundaries", () => {
  it("declares exactly the modules and directories under src/ as layers", async () => {
    const onDisk = await entries("src");

    expect([...layers].sort()).toEqual(
      onDisk.filter((name) => name !== "index").sort(),
    );
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
