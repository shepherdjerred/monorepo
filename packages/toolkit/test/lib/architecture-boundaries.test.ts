import { assertArchitectureFixtures } from "@shepherdjerred/architecture";
import { test } from "vitest";
import architecture from "#architecture";

test("architecture fixtures prove every toolkit boundary", async () => {
  await assertArchitectureFixtures({
    packageRoot: import.meta.dir.replace(/\/test\/lib$/u, ""),
    definition: architecture,
  });
});
