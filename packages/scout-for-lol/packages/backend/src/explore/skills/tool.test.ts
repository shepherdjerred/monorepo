import { describe, expect, test } from "vitest";
import { createLoadSkillExecutor } from "#src/explore/skills/tool.ts";
import { enabledExploreSkills } from "#src/explore/skills/registry.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

function harness(options?: { bucks?: boolean }) {
  const bucks =
    options?.bucks === true
      ? { currentTime: "2026-08-29T00:00:00.000Z" }
      : null;
  const tracked: string[] = [];
  const loaded: string[] = [];
  const track: ToolTracker = async (toolName, work) => {
    tracked.push(toolName);
    return await work();
  };
  const execute = createLoadSkillExecutor({
    skills: enabledExploreSkills({ bucks, surface: "web" }),
    context: { bucks, surface: "web" },
    track,
    onLoaded: (name) => loaded.push(name),
  });
  return { execute, tracked, loaded };
}

describe("load_skill executor", () => {
  test("returns an enabled skill's rendered instructions", async () => {
    const { execute, tracked, loaded } = harness();
    const result = await execute("visualization");
    expect(result.ok).toBe(true);
    expect(result.instructions?.length).toBeGreaterThan(0);
    expect(tracked).toEqual(["load_skill"]);
    expect(loaded).toEqual(["visualization"]);
  });

  test("a capability-gated skill is refused with the available list", async () => {
    const { execute, loaded } = harness();
    const result = await execute("bryan-bucks");
    expect(result.ok).toBe(false);
    expect(result.instructions).toBeNull();
    expect(result.message).toContain("Available skills:");
    expect(result.message).toContain("visualization");
    expect(loaded).toEqual([]);
  });

  test("the same skill loads once bucks capability exists", async () => {
    const { execute } = harness({ bucks: true });
    const result = await execute("bryan-bucks");
    expect(result.ok).toBe(true);
    expect(result.instructions).toContain("2026-08-29T00:00:00.000Z");
  });

  test("a hallucinated name is refused without echo into the throw path", async () => {
    const { execute } = harness();
    const result = await execute("definitely-not-a-skill");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("definitely-not-a-skill");
  });
});
