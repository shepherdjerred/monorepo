import { readdir } from "node:fs/promises";
import path from "node:path";
import { assertArchitectureFixtures } from "@shepherdjerred/architecture";
import { describe, expect, it, test } from "vitest";
import architecture from "#architecture";

const packageRoot = import.meta.dir.replace(/\/test$/u, "");

test("architecture fixtures prove every pr-fleet-controller boundary", async () => {
  await assertArchitectureFixtures({
    packageRoot,
    definition: architecture,
  });
});

describe("dependency-cruiser layer boundaries", () => {
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
