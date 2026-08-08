import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { createAgentTaskSecretTokenState } from "./agent-task-env.ts";

describe("agent-task secret token state", () => {
  it("refreshes rotated mounted credentials in place", async () => {
    const tokenPath = path.join(
      os.tmpdir(),
      `agent-task-rotated-secret-${crypto.randomUUID()}`,
    );
    await Bun.write(tokenPath, "first-mounted-secret-value\n");

    try {
      const state = await createAgentTaskSecretTokenState("github-token", {}, [
        tokenPath,
      ]);
      await Bun.write(tokenPath, "second-mounted-secret-value\n");
      await state.refresh();

      expect(state.tokens).not.toContain("first-mounted-secret-value");
      expect(state.tokens).toContain("second-mounted-secret-value");
    } finally {
      await rm(tokenPath);
    }
  });
});
