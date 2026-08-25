import { assertArchitectureFixtures } from "@shepherdjerred/architecture";
import { test } from "vitest";
import architecture from "#architecture";

test("architecture fixtures prove every Pokemon backend boundary", async () => {
  await assertArchitectureFixtures({
    packageRoot: import.meta.dir.replace(/\/src$/u, ""),
    definition: architecture,
  });
});
