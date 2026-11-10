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
} from "../lib/agent-guidance-files.ts";

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
    skill("packages/dotfiles/dot_agents/skills/personal/SKILL.md", "personal"),
    symlink("packages/dotfiles/CLAUDE.md", "AGENTS.md"),
    file(
      "packages/dotfiles/private_dot_claude/symlink_CLAUDE.md",
      "../AGENTS.md\n",
    ),
    file(
      "packages/dotfiles/private_dot_claude/symlink_skills",
      "../.agents/skills\n",
    ),
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
      "---\ndescription: Use the canonical personal and repository agent guidance\nalwaysApply: true\n---\n\nFollow `~/AGENTS.md`, then the nearest repository `AGENTS.md`. Load matching\nskills from `.agents/skills`; do not duplicate their instructions here.\n",
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

async function commitFixture(repositoryRoot: string): Promise<void> {
  await runGit(repositoryRoot, [
    "-c",
    "user.name=Guidance Fixture",
    "-c",
    "user.email=guidance@example.invalid",
    "commit",
    "--quiet",
    "--message",
    "guidance fixture",
  ]);
}

async function withGuidanceRepository(
  run: (repositoryRoot: string, homeAgentPath: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    nodePath.join(tmpdir(), "agent-guidance-staged-"),
  );
  const repositoryRoot = nodePath.join(directory, "repository");
  const homeAgentPath = nodePath.join(directory, "home", "AGENTS.md");
  try {
    await mkdir(repositoryRoot);
    await mkdir(nodePath.dirname(homeAgentPath));
    await runGit(repositoryRoot, ["init", "--quiet"]);
    const entries = validFixture();
    for (const entry of entries) {
      const destination = nodePath.join(repositoryRoot, entry.path);
      await mkdir(nodePath.dirname(destination), { recursive: true });
      if (entry.kind === "symlink") {
        await createSymlink(entry.contents, destination);
      } else {
        await writeFile(destination, entry.contents);
      }
    }
    await runGit(repositoryRoot, [
      "add",
      "--",
      ...entries.map((entry) => entry.path),
    ]);
    await commitFixture(repositoryRoot);
    await run(repositoryRoot, homeAgentPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("agent guidance guard", () => {
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
    for (let index = 0; index < 25; index += 1) {
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
      file("packages/app/GEMINI.md", "duplicated guidance"),
      file(".claude/skills/delivery/SKILL.md", "duplicated skill"),
      skill(
        "packages/app/.claude/skills/package-copy/SKILL.md",
        "package-copy",
      ),
      skill(
        "packages/dotfiles/private_dot_cursor/skills/cursor-copy/SKILL.md",
        "cursor-copy",
      ),
      skill(
        "packages/dotfiles/dot_gemini/config/skills/gemini-copy/SKILL.md",
        "gemini-copy",
      ),
      skill(
        "packages/dotfiles/private_dot_codex/skills/codex-copy/SKILL.md",
        "codex-copy",
      ),
      skill(".gemini/config/skills/literal-copy/SKILL.md", "literal-copy"),
    );
    const found = rules(entries);
    expect(found).toEqual(expect.arrayContaining(["repository-cursor-rule"]));
    expect(found).toContain("repository-gemini-guidance");
    expect(
      found.filter((rule) => rule === "duplicate-client-skill"),
    ).toHaveLength(6);
  });

  test("rejects policy appended to the Cursor adapter", () => {
    const entries = validFixture().map((entry) =>
      entry.path ===
      "packages/dotfiles/private_dot_cursor/rules/agent-guidance.mdc"
        ? { ...entry, contents: `${entry.contents}Extra policy.\n` }
        : entry,
    );
    expect(rules(entries)).toContain("cursor-adapter");
  });

  test("rejects an oversized personal skill catalog", () => {
    const entries = validFixture();
    for (let index = 0; index < 25; index += 1) {
      entries.push(
        skill(
          `packages/dotfiles/dot_agents/skills/personal-${index.toString()}/SKILL.md`,
          `personal-${index.toString()}`,
          "x".repeat(1000),
        ),
      );
    }
    expect(rules(entries)).toContain("skill-catalog-bytes");
  });

  test("rejects missing canonical source for global adapters", () => {
    const entries = validFixture().filter(
      ({ path }) => path !== "packages/dotfiles/AGENTS.md",
    );
    expect(rules(entries)).toContain("source-adapter-target");
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

describe("agent guidance edge cases", () => {
  test("allows documents whose names merely end with GEMINI.md", () => {
    const entries = validFixture();
    entries.push(
      file("packages/app/USING-GEMINI.md", "ordinary documentation"),
    );
    expect(rules(entries)).not.toContain("repository-gemini-guidance");
  });

  test("rejects missing canonical source for global skill adapters", () => {
    const entries = validFixture().filter(
      ({ path }) => !path.startsWith("packages/dotfiles/dot_agents/skills/"),
    );
    expect(rules(entries)).toContain("source-adapter-target");
  });
});

describe("agent guidance compatibility", () => {
  test("rejects an orphaned nested Claude compatibility link", () => {
    const entries = validFixture();
    entries.push(symlink("packages/app/CLAUDE.md", "AGENTS.md"));
    expect(rules(entries)).toContain("claude-compatibility");
  });

  test("reads staged guidance content from the index", async () => {
    const repositoryRoot = await mkdtemp(
      nodePath.join(tmpdir(), "agent-guidance-index-"),
    );
    try {
      await runGit(repositoryRoot, ["init", "--quiet"]);
      await writeFile(nodePath.join(repositoryRoot, "AGENTS.md"), "# Staged\n");
      await runGit(repositoryRoot, ["add", "AGENTS.md"]);
      await writeFile(
        nodePath.join(repositoryRoot, "AGENTS.md"),
        "x\n".repeat(201),
      );

      const entries = await listGuidanceEntries(
        new Set(),
        repositoryRoot,
        "index",
      );

      expect(entries).toContainEqual({
        path: "AGENTS.md",
        kind: "file",
        contents: "# Staged\n",
      });

      const worktreeEntries = await listGuidanceEntries(
        new Set(),
        repositoryRoot,
      );
      expect(worktreeEntries).toContainEqual({
        path: "AGENTS.md",
        kind: "file",
        contents: "x\n".repeat(201),
      });
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  test("detects drift between ~/AGENTS.md and packages/dotfiles/AGENTS.md", async () => {
    const tempDir = await mkdtemp(nodePath.join(tmpdir(), "agent-drift-"));
    try {
      const homeAgentPath = nodePath.join(tempDir, "AGENTS.md");
      await writeFile(homeAgentPath, "# Live Home Guidance\n");

      const entries = validFixture();
      const violations = validateAgentGuidance(entries, {
        homeAgentPath,
        liveContent: "# Live Home Guidance\n",
      });
      expect(violations).toContainEqual({
        rule: "personal-agent-drift",
        path: "packages/dotfiles/AGENTS.md",
        message: `differs from live ${homeAgentPath}; inspect the diff and choose the intended synchronization direction`,
      });

      // When contents match, no drift violation is reported
      await writeFile(homeAgentPath, "# Personal\n");
      const cleanViolations = validateAgentGuidance(entries, {
        homeAgentPath,
        liveContent: "# Personal\n",
      });
      expect(cleanViolations).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ignores drift check if liveContent is undefined", () => {
    const entries = validFixture();
    const nonExistentPath = nodePath.join(
      tmpdir(),
      "non-existent-agents-file.md",
    );
    expect(
      validateAgentGuidance(entries, { homeAgentPath: nonExistentPath }),
    ).toEqual([]);
  });
});

describe("staged agent guidance checks", () => {
  test("scans the repository layout independently of local home guidance", async () => {
    await withGuidanceRepository(async (_, homeAgentPath) => {
      await expect(
        checkAgentGuidance("worktree", { homeAgentPath }),
      ).resolves.toBeUndefined();
    });
  });

  test("skips unrelated commits despite divergent home and repository guidance", async () => {
    await withGuidanceRepository(async (repositoryRoot, homeAgentPath) => {
      await writeFile(homeAgentPath, "# Newer personal preferences\n");
      await writeFile(
        nodePath.join(repositoryRoot, "AGENTS.md"),
        "x\n".repeat(201),
      );
      await runGit(repositoryRoot, ["add", "AGENTS.md"]);
      await commitFixture(repositoryRoot);
      await writeFile(
        nodePath.join(repositoryRoot, "README.md"),
        "Application change\n",
      );
      await runGit(repositoryRoot, ["add", "README.md"]);

      await expect(
        checkAgentGuidance("index", { repositoryRoot, homeAgentPath }),
      ).resolves.toBeUndefined();
      expect(await Bun.file(homeAgentPath).text()).toBe(
        "# Newer personal preferences\n",
      );
    });
  });

  test("does not read home guidance when only repository guidance is staged", async () => {
    await withGuidanceRepository(async (repositoryRoot, homeAgentPath) => {
      // A directory would fail a file read, proving this staged path never reads it.
      await mkdir(homeAgentPath);
      await writeFile(
        nodePath.join(repositoryRoot, "AGENTS.md"),
        "# Updated repository\n",
      );
      await runGit(repositoryRoot, ["add", "AGENTS.md"]);

      await expect(
        checkAgentGuidance("index", { repositoryRoot, homeAgentPath }),
      ).resolves.toBeUndefined();
    });
  });

  test("still validates the layout when a guidance adapter is deleted", async () => {
    await withGuidanceRepository(async (repositoryRoot, homeAgentPath) => {
      await runGit(repositoryRoot, ["rm", "CLAUDE.md"]);

      await expect(
        checkAgentGuidance("index", { repositoryRoot, homeAgentPath }),
      ).rejects.toThrow("repository-symlink");
    });
  });

  test("compares staged personal guidance with home rather than the worktree", async () => {
    await withGuidanceRepository(async (repositoryRoot, homeAgentPath) => {
      const personalSource = nodePath.join(
        repositoryRoot,
        "packages/dotfiles/AGENTS.md",
      );
      await writeFile(personalSource, "# Staged personal instructions\n");
      await runGit(repositoryRoot, ["add", "packages/dotfiles/AGENTS.md"]);
      await writeFile(personalSource, "# Live personal instructions\n");
      await writeFile(homeAgentPath, "# Live personal instructions\n");

      await expect(
        checkAgentGuidance("index", { repositoryRoot, homeAgentPath }),
      ).rejects.toThrow("personal-agent-drift");

      await writeFile(homeAgentPath, "# Staged personal instructions\n");
      await expect(
        checkAgentGuidance("index", { repositoryRoot, homeAgentPath }),
      ).resolves.toBeUndefined();
    });
  });

  test("allows staged personal guidance when CI has no home file", async () => {
    await withGuidanceRepository(async (repositoryRoot, homeAgentPath) => {
      await writeFile(
        nodePath.join(repositoryRoot, "packages/dotfiles/AGENTS.md"),
        "# Updated personal guidance\n",
      );
      await runGit(repositoryRoot, ["add", "packages/dotfiles/AGENTS.md"]);

      await expect(
        checkAgentGuidance("index", { repositoryRoot, homeAgentPath }),
      ).resolves.toBeUndefined();
    });
  });

  test("explicit full checks detect home drift without staged guidance", async () => {
    await withGuidanceRepository(async (repositoryRoot, homeAgentPath) => {
      await writeFile(homeAgentPath, "# Different personal guidance\n");

      await expect(
        checkAgentGuidance("worktree", { repositoryRoot, homeAgentPath }),
      ).rejects.toThrow("personal-agent-drift");
    });
  });
});
