import path from "node:path";
import { describe, expect, test } from "vitest";

const dotfilesRoot = path.resolve(import.meta.dir, "..");
const skillPath = path.join(
  dotfilesRoot,
  "dot_agents/skills/ci-driver/SKILL.md",
);
const agentPath = path.join(
  dotfilesRoot,
  "private_dot_claude/agents/ci-driver.md",
);

describe("ci-driver skill and Claude subagent contract (AI-737)", () => {
  test("forbids run_in_background and premature turn endings inside delegated subagents", async () => {
    const [skill, agent] = await Promise.all([
      Bun.file(skillPath).text(),
      Bun.file(agentPath).text(),
    ]);

    expect(skill).toMatch(/never[\s\S]{0,40}`run_in_background`/iu);
    expect(skill).not.toMatch(/do not read the output file/iu);
    expect(skill).toContain("timeout: 600000");
    expect(skill).toContain("--timeout 9m");
    expect(skill).toContain("12 slices");
    expect(skill).toContain("toolkit pr review list <PR> --json");

    expect(agent).toMatch(/^---\nname: ci-driver\n/u);
    expect(agent).toMatch(/never use\s+`run_in_background`/iu);
    expect(agent).toMatch(/never end a turn while CI is still pending/iu);
    expect(agent).toContain("toolkit pr review list <PR> --json");
  });
});
