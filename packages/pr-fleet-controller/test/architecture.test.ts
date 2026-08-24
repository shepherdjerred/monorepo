import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cruiseArchitectureFixtures,
  expectedFixtureRuleNames,
} from "@shepherdjerred/architecture";
import architecture from "#architecture";

const packageRoot = import.meta.dir.replace(/\/test$/u, "");

describe("dependency-cruiser layer boundaries", () => {
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

  it("leaves no module outside a layer directory", async () => {
    // Boundaries name directories, so a module sitting directly under `src/`
    // is one no rule can match — from or to. The package used to export a
    // `src/index.ts` facade that imported the controller, which gave every
    // layer an ungoverned path into the master loop while every declared
    // boundary still passed.
    const entries = await readdir(path.join(packageRoot, "src"), {
      withFileTypes: true,
    });
    const ungoverned = entries
      .filter((entry) => !entry.isDirectory())
      .map((entry) => entry.name);

    expect(ungoverned).toEqual([]);
  });
});
