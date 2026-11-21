import { assertArchitectureFixtures } from "@shepherdjerred/architecture";
import { describe, it } from "vitest";
import architecture from "#architecture";

const packageRoot = import.meta.dir.replace(/\/src\/domain$/u, "");

describe("golink architecture boundaries", () => {
  it("rejects a committed negative fixture for every declared boundary", async () => {
    await assertArchitectureFixtures({
      packageRoot,
      definition: architecture,
    });
  });
});
