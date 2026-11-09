import { describe, expect, test } from "vitest";
import {
  claudeDenyRules,
  codexRules,
  generate,
  parsePolicy,
} from "./agent-policy.ts";

describe("agent policy", () => {
  test("generated Claude and Codex denylists match the shared source", async () => {
    const outputs = await generate();
    const stale = outputs
      .filter((output) => !output.current)
      .map((output) => output.path);
    expect(stale).toEqual([]);
  });

  test("expands unions, toolkit passthroughs, and flags for Claude", () => {
    const commands = parsePolicy({
      commands: [
        { pattern: [["sudo", "su"]], reason: "privileged" },
        {
          pattern: ["argocd", "app", "sync"],
          flag: "--prune",
          toolkit: true,
          reason: "prune",
        },
      ],
    });
    expect(claudeDenyRules(commands)).toEqual([
      "Bash(sudo *)",
      "Bash(su *)",
      "Bash(argocd app sync*--prune*)",
      "Bash(toolkit argocd app sync*--prune*)",
    ]);
  });

  test("renders unions as Codex prefix rule positions", () => {
    const rules = codexRules(
      parsePolicy({
        commands: [
          { pattern: ["talosctl", ["reset", "wipe"]], reason: "node" },
        ],
      }),
    );
    expect(rules).toContain(`pattern = ["talosctl", ["reset", "wipe"]],`);
    expect(rules).toContain(`justification = "node",`);
  });

  test("rejects words Codex would never match and unknown fields", () => {
    expect(() =>
      parsePolicy({ commands: [{ pattern: ["rm", "/*"], reason: "x" }] }),
    ).toThrow("plain shell word");
    expect(() =>
      parsePolicy({ commands: [{ pattern: ["rm", "~"], reason: "x" }] }),
    ).toThrow("plain shell word");
    expect(() =>
      parsePolicy({ commands: [{ pattern: ["rm"], reson: "x" }] }),
    ).toThrow("reson");
    expect(() =>
      parsePolicy({ commands: [{ pattern: [["sudo"]], reason: "x" }] }),
    ).toThrow("at least two alternatives");
  });
});
