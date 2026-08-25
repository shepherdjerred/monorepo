import { assertArchitectureFixtures } from "@shepherdjerred/architecture";
import { test } from "vitest";
import architecture from "#architecture";

test("architecture fixtures prove every Temporal boundary", async () => {
  await assertArchitectureFixtures({
    packageRoot: import.meta.dir.replace(/\/src\/shared$/u, ""),
    definition: architecture,
  });
});
