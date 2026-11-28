import path from "node:path";
import { assertArchitectureFixtures } from "@shepherdjerred/architecture";
import { describe, it } from "vitest";
import architecture from "#architecture";

const packageRoot = path.resolve(import.meta.dir, "..");

describe("incidents architecture boundaries", () => {
  it("rejects a committed negative fixture for every declared boundary", async () => {
    await assertArchitectureFixtures({
      packageRoot,
      definition: architecture,
    });
  });
});
