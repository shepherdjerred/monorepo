export function installPaths(home: string): {
  readonly binary: string;
  readonly legacyBinary: string;
  readonly skill: string;
} {
  return {
    binary: `${home}/.local/bin/toolkit`,
    legacyBinary: `${home}/.local/bin/tools`,
    skill: `${home}/.claude/skills/pr-health/SKILL.md`,
  };
}
