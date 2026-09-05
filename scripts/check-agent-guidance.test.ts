import {
  mkdir,
  mkdtemp,
  rm,
  symlink as createSymlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { describe, expect, test } from "vitest";

import {
  claudeCompatibilityPath,
  checkAgentGuidance,
  validateAgentGuidance,
} from "./check-agent-guidance.ts";
import {
  listGuidanceEntries,
  type GuidanceEntry,
} from "./lib/agent-guidance-files.ts";

function file(path: string, contents: string): GuidanceEntry {
  return { path, kind: "file", contents };
}

function symlink(path: string, target: string): GuidanceEntry {
  return { path, kind: "symlink", contents: target };
}

function skill(path: string, name: string, description = "Useful workflow.") {
  return file(
    path,
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# Workflow\n`,
  );
}

function validFixture(): GuidanceEntry[] {
  return [
    file("AGENTS.md", "# Repository\n"),
    symlink("CLAUDE.md", "AGENTS.md"),
    symlink(".claude/skills", "../.agents/skills"),
    file("packages/dotfiles/AGENTS.md", "# Personal\n"),
    symlink("packages/dotfiles/CLAUDE.md", "AGENTS.md"),
    file("packages/dotfiles/dot_claude/symlink_CLAUDE.md", "../AGENTS.md\n"),
    file("packages/dotfiles/dot_claude/symlink_skills", "../.agents/skills\n"),
    file(
      "packages/dotfiles/private_dot_codex/symlink_AGENTS.md",
      "../AGENTS.md\n",
    ),
    file("packages/dotfiles/dot_gemini/symlink_GEMINI.md", "../AGENTS.md\n"),
    file(
      "packages/dotfiles/dot_gemini/config/symlink_skills",
      "../../.agents/skills\n",
    ),
    file(
      "packages/dotfiles/private_dot_cursor/rules/agent-guidance.mdc",
      "---\nalwaysApply: true\n---\nFollow ~/AGENTS.md.\n",
    ),
    skill(".agents/skills/delivery/SKILL.md", "delivery"),
  ];
}

function rules(entries: readonly GuidanceEntry[]): string[] {
  return validateAgentGuidance(entries).map(({ rule }) => rule);
}

async function runGit(repositoryRoot: string, args: readonly string[]) {
  const process = Bun.spawn(["git", ...args], {
    cwd: repositoryRoot,
    stdout: "ignore",
    stderr: "pipe",
  });
  expect(await process.exited).toBe(0);
}

describe("agent guidance guard", () => {
  test("scans the repository layout", async () => {
    await expect(checkAgentGuidance()).resolves.toBeUndefined();
  });

  test("uses portable Git paths for nested Claude compatibility links", () => {
    expect(claudeCompatibilityPath("packages/app/AGENTS.md")).toBe(
      "packages/app/CLAUDE.md",
    );
  });

  test("discovers guidance under arbitrary top-level directories", async () => {
    const repositoryRoot = await mkdtemp(
      nodePath.join(tmpdir(), "agent-guidance-discovery-"),
    );
    try {
      await runGit(repositoryRoot, ["init", "--quiet"]);
      await mkdir(nodePath.join(repositoryRoot, "scripts", "fixture"), {
        recursive: true,
      });
      await writeFile(
        nodePath.join(repositoryRoot, "scripts", "fixture", "AGENTS.md"),
        "# Fixture\n",
      );
      await writeFile(nodePath.join(repositoryRoot, "AGENTS.md"), "# Root\n");
      const claudePath = nodePath.join(repositoryRoot, "CLAUDE.md");
      await createSymlink("AGENTS.md", claudePath);
      await runGit(repositoryRoot, ["add", "AGENTS.md", "CLAUDE.md"]);
      await rm(claudePath);
      await writeFile(claudePath, "AGENTS.md");

      const entries = await listGuidanceEntries(new Set(), repositoryRoot);

      expect(entries.map((entry) => entry.path)).toContain(
        "scripts/fixture/AGENTS.md",
      );
      expect(entries).toContainEqual({
        path: "CLAUDE.md",
        kind: "symlink",
        contents: "AGENTS.md",
      });
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  test("accepts the canonical fixture", () => {
    expect(validateAgentGuidance(validFixture())).toEqual([]);
  });

  test.each([
    ["root-agent-lines", "AGENTS.md", "x\n".repeat(201)],
    ["root-agent-bytes", "AGENTS.md", "x".repeat(16 * 1024 + 1)],
    ["nested-agent-lines", "packages/app/AGENTS.md", "x\n".repeat(121)],
    ["nested-agent-bytes", "packages/app/AGENTS.md", "x".repeat(8 * 1024 + 1)],
  ])("rejects %s", (expectedRule, entryPath, contents) => {
    const entries = validFixture();
    entries.push(file(entryPath, contents));
    if (entryPath !== "AGENTS.md") {
      entries.push(symlink("packages/app/CLAUDE.md", "AGENTS.md"));
    }
    expect(rules(entries)).toContain(expectedRule);
  });

  test.each([
    ["skill-lines", "x\n".repeat(161)],
    ["skill-bytes", "x".repeat(12 * 1024 + 1)],
    ["skill-frontmatter", "# Missing frontmatter\n"],
  ])("rejects %s", (expectedRule, contents) => {
    const entries = validFixture();
    entries.push(file("packages/toolkit/skills/extra/SKILL.md", contents));
    expect(rules(entries)).toContain(expectedRule);
  });

  test("rejects invalid, mismatched, duplicated, and overlong skill metadata", () => {
    const entries = validFixture();
    entries.push(
      skill(".agents/skills/wrong/SKILL.md", "Wrong_Name", "x".repeat(1025)),
      skill("packages/toolkit/skills/copy/SKILL.md", "delivery"),
    );
    const found = rules(entries);
    expect(found).toEqual(
      expect.arrayContaining([
        "skill-id",
        "skill-directory",
        "skill-description",
        "duplicate-skill-id",
      ]),
    );
  });

  test("rejects client-specific skill frontmatter fields", () => {
    const entries = validFixture();
    entries.push(
      file(
        ".agents/skills/nonportable/SKILL.md",
        "---\nname: nonportable\ndescription: Useful.\nuser-invocable: true\n---\n",
      ),
    );
    expect(rules(entries)).toContain("skill-frontmatter-portability");
  });

  test("rejects a catalog whose discovery metadata exceeds its budget", () => {
    const entries = validFixture();
    for (let index = 0; index < 9; index += 1) {
      entries.push(
        skill(
          `.agents/skills/skill-${index.toString()}/SKILL.md`,
          `skill-${index.toString()}`,
          "x".repeat(1000),
        ),
      );
    }
    expect(rules(entries)).toContain("skill-catalog-bytes");
  });

  test("rejects missing and incorrect compatibility links and adapters", () => {
    const entries = validFixture().filter(
      ({ path }) =>
        path !== ".claude/skills" &&
        path !== "packages/dotfiles/private_dot_codex/symlink_AGENTS.md",
    );
    const found = rules(entries);
    expect(found).toContain("repository-symlink");
    expect(found).toContain("source-adapter");
  });

  test("rejects a dangling compatibility link", () => {
    const entries = validFixture().filter(({ path }) => path !== "AGENTS.md");
    expect(rules(entries)).toContain("repository-symlink");
  });

  test("rejects a missing nested Claude link and a missing Cursor adapter", () => {
    const entries = validFixture().filter(
      ({ path }) =>
        path !==
        "packages/dotfiles/private_dot_cursor/rules/agent-guidance.mdc",
    );
    entries.push(file("packages/app/AGENTS.md", "# App\n"));
    const found = rules(entries);
    expect(found).toContain("claude-compatibility");
    expect(found).toContain("cursor-adapter");
  });

  test("rejects repository Cursor prose and client-specific skill copies", () => {
    const entries = validFixture();
    entries.push(
      file("packages/app/.cursor/rules/local.mdc", "duplicated prose"),
      file(".claude/skills/delivery/SKILL.md", "duplicated skill"),
      skill(
        "packages/app/.claude/skills/package-copy/SKILL.md",
        "package-copy",
      ),
      skill(
        "packages/dotfiles/private_dot_cursor/skills/cursor-copy/SKILL.md",
        "cursor-copy",
      ),
    );
    const found = rules(entries);
    expect(found).toEqual(expect.arrayContaining(["repository-cursor-rule"]));
    expect(
      found.filter((rule) => rule === "duplicate-client-skill"),
    ).toHaveLength(3);
  });

  test("ignores archived sandbox guidance", () => {
    const entries = validFixture();
    entries.push(
      file("sandbox/archive/old/AGENTS.md", "x\n".repeat(1000)),
      file("sandbox/archive/old/.cursor/rules/old.mdc", "old"),
    );
    expect(validateAgentGuidance(entries)).toEqual([]);
  });
});
