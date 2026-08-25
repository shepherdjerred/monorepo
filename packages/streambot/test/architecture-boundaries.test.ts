import { assertArchitectureFixtures } from "@shepherdjerred/architecture";
import { test } from "vitest";
import architecture from "#architecture";

test("architecture fixtures prove every Streambot boundary", async () => {
  await assertArchitectureFixtures({
    packageRoot: import.meta.dir.replace(/\/test$/u, ""),
    definition: architecture,
  });
});
