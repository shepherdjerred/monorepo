import { describe, expect, it } from "vitest";
import {
  cruiseArchitectureFixtures,
  expectedFixtureRuleNames,
} from "@shepherdjerred/architecture";
import architecture from "#architecture";

const packageRoot = import.meta.dir.replace(/\/test\/lib$/u, "");

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
});
