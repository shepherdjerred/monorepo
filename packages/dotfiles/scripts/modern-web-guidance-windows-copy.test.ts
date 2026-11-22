// Personal agent skills live once in packages/dotfiles/dot_agents/skills and
// are synced onto Windows as real files by run_onchange_before_sync-agent-skills.ps1.tmpl
// before Claude and Gemini adapter symlinks are created pointing at ~/.agents/skills.
import path from "node:path";
import { expect, test } from "vitest";

const macSkills = path.join(import.meta.dirname, "../dot_agents/skills");
const windowsRoot = path.join(import.meta.dirname, "../../dotfiles-windows");
const windowsSkillsDir = path.join(windowsRoot, "dot_agents/skills");
const skillsSyncTemplate = path.join(
  windowsRoot,
  "run_onchange_before_sync-agent-skills.ps1.tmpl",
);
const chezmoiShimTemplate = path.join(
  windowsRoot,
  "run_after_sync-chezmoi-shim.ps1.tmpl",
);

test("packages/dotfiles-windows has no duplicated git copies of personal skills", () => {
  const duplicated = [
    ...new Bun.Glob("**/*").scanSync({
      cwd: windowsRoot,
      dot: true,
    }),
  ]
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => file.startsWith("dot_agents/skills/"));
  expect(duplicated).toEqual([]);
  expect(
    Bun.file(path.join(windowsSkillsDir, "modern-web-guidance/SKILL.md")).size,
  ).toBe(0);
});

test("canonical personal skills catalog is non-empty and synced by Windows template", async () => {
  const canonicalSkills = [
    ...new Bun.Glob("*/SKILL.md").scanSync({ cwd: macSkills }),
  ];
  expect(canonicalSkills.length).toBeGreaterThan(20);
  expect(canonicalSkills.map((s) => s.replaceAll("\\", "/"))).toContain(
    "modern-web-guidance/SKILL.md",
  );

  const template = await Bun.file(skillsSyncTemplate).text();
  expect(template).toContain(
    'joinPath (dir .chezmoi.sourceDir) "dotfiles" "dot_agents" "skills"',
  );
  expect(template).toContain("sha256sum");
  expect(template).toContain(String.raw`.agents\skills`);
});

test("Windows dotfiles expose Claude and Gemini skill and guidance adapter symlinks", async () => {
  const adapters = [
    ["private_dot_claude/symlink_CLAUDE.md", "../AGENTS.md"],
    ["private_dot_claude/symlink_skills", "../.agents/skills"],
    ["private_dot_codex/symlink_AGENTS.md", "../AGENTS.md"],
    ["dot_gemini/symlink_GEMINI.md", "../AGENTS.md"],
    ["dot_gemini/config/symlink_skills", "../../.agents/skills"],
  ] as const;

  for (const [relativePath, expectedTarget] of adapters) {
    const content = await Bun.file(path.join(windowsRoot, relativePath)).text();
    expect(content.trim(), relativePath).toBe(expectedTarget);
  }
});

test("Windows chezmoi shim script keeps ~/.local/bin before WinGet Links and mirrors chezmoi.exe", async () => {
  const template = await Bun.file(chezmoiShimTemplate).text();
  expect(template).toContain(String.raw`Microsoft\WinGet\Links`);
  expect(template).toContain("twpayne.chezmoi_*");
  expect(template).toContain("chezmoi.exe");
});
