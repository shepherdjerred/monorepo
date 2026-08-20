import { describe, expect, test } from "bun:test";
import { SETUP_COMMANDS } from "@shepherdjerred/pr-fleet-controller/src/worker-setup-tool.ts";

describe("worktree setup", () => {
  test("keeps setup serial and deterministic", () => {
    expect(SETUP_COMMANDS.map((command) => command.executable)).toEqual([
      "mise",
      "bun",
      "bunx",
    ]);
    expect(SETUP_COMMANDS[0]).toEqual({
      executable: "mise",
      args: ["install", "--dry-run-code"],
    });
    expect(SETUP_COMMANDS.at(-1)).toEqual({
      executable: "bunx",
      args: ["turbo", "run", "generate", "--env-mode=loose"],
    });
  });
});
