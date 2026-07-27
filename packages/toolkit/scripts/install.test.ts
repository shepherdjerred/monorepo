import { expect, test } from "bun:test";
import { installPaths } from "./install-core.ts";

test("installation remains scoped below the supplied home directory", () => {
  expect(installPaths("/home/test")).toEqual({
    binary: "/home/test/.local/bin/toolkit",
    legacyBinary: "/home/test/.local/bin/tools",
    skill: "/home/test/.claude/skills/pr-health/SKILL.md",
  });
});
