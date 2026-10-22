import { describe, expect, test } from "vitest";
import {
  loadExploreSkillFiles,
  parseExploreSkillFile,
} from "#src/explore/skills/loader.ts";

function surfaceSkillFile(name: string): string {
  return [
    "---",
    `name: ${name}`,
    "description: A skill.",
    "capability: always",
    "outputFor: [web]",
    "tripwires: []",
    "---",
    "Body.",
  ].join("\n");
}

describe("explore skill loader", () => {
  test("loads every content file with valid frontmatter", async () => {
    const skills = await loadExploreSkillFiles();
    expect(skills.length).toBeGreaterThanOrEqual(7);
    for (const skill of skills) {
      expect(skill.name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.body.length).toBeGreaterThan(0);
      // A capability reaches every surface; only delivery skills narrow it.
      if (skill.outputFor !== undefined) {
        expect(skill.capability).toBe("always");
      }
    }
  });

  test("skill names are unique and sorted for a deterministic index", async () => {
    const skills = await loadExploreSkillFiles();
    const names = skills.map((skill) => skill.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].toSorted((a, b) => a.localeCompare(b)));
  });

  test("analysis instructions use canonical raw identities without translation maps", async () => {
    const skills = await loadExploreSkillFiles();
    const analysis = skills.find((skill) => skill.name === "data-analysis");
    expect(analysis?.body).toContain("Join canonical PUUIDs directly");
    expect(analysis?.body).toContain("no identity translation map is returned");
    expect(analysis?.body).not.toContain("use the mapping");
    expect(analysis?.body).not.toContain("identity mapping supports");
  });

  test("only a delivery skill may narrow itself to some surfaces", () => {
    expect(() =>
      parseExploreSkillFile("loadouts.md", surfaceSkillFile("loadouts")),
    ).toThrow(/delivery-only/);
    expect(() =>
      parseExploreSkillFile(
        "voice-response.md",
        surfaceSkillFile("voice-response"),
      ),
    ).not.toThrow();
  });

  test("rejects a file without frontmatter", () => {
    expect(() => parseExploreSkillFile("bad.md", "just a body")).toThrow(
      /frontmatter/,
    );
  });

  test("rejects an empty body", () => {
    const raw = [
      "---",
      "name: empty",
      "description: d",
      "capability: always",
      "tripwires: []",
      "---",
      "",
    ].join("\n");
    expect(() => parseExploreSkillFile("empty.md", raw)).toThrow(/empty body/);
  });

  test("rejects unknown frontmatter keys and capabilities", () => {
    const unknownKey = [
      "---",
      "name: x",
      "description: d",
      "capability: always",
      "tripwires: []",
      "extra: nope",
      "---",
      "body",
    ].join("\n");
    expect(() => parseExploreSkillFile("x.md", unknownKey)).toThrow();

    const badCapability = unknownKey
      .replace("extra: nope\n", "")
      .replace("capability: always", "capability: wizardry");
    expect(() => parseExploreSkillFile("x.md", badCapability)).toThrow();
  });

  test("collects placeholders from the body", () => {
    const raw = [
      "---",
      "name: x",
      "description: d",
      "capability: always",
      "tripwires: []",
      "---",
      "Uses {{alpha}} and {{beta}} and {{alpha}} again, but not {single}.",
    ].join("\n");
    const skill = parseExploreSkillFile("x.md", raw);
    expect(skill.placeholders).toEqual(["alpha", "beta"]);
  });
});
