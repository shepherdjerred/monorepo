#!/usr/bin/env bun
import os from "node:os";
import path from "node:path";
import {
  addBudgetViolations,
  AGENT_MAX_BYTES,
  AGENT_MAX_LINES,
  byteCount,
  catalogRoot,
  CATALOG_MAX_BYTES,
  claudeCompatibilityPath as libClaudeCompatibilityPath,
  CLIENT_SKILL_DIRECTORIES,
  CURSOR_ADAPTER_CONTENT,
  CURSOR_ADAPTER_PATH,
  GEMINI_SKILL_DIRECTORIES,
  GEMINI_SOURCE_ADAPTER_PATH,
  gitPath,
  hasPathOrDescendant,
  isArchived,
  isGlobalReferenceSkill,
  isSkill,
  listGuidanceEntries,
  parseSkillFrontmatter,
  PERSONAL_AGENT_PATH,
  PERSONAL_SKILLS_PATH,
  PORTABLE_SKILL_FIELDS,
  REQUIRED_SOURCE_ADAPTERS,
  ROOT_AGENT_MAX_BYTES,
  ROOT_AGENT_MAX_LINES,
  ROOT_AGENT_PATHS,
  ROOT_SYMLINKS,
  SKILL_ID,
  SKILL_MAX_BYTES,
  SKILL_MAX_LINES,
  skillDirectoryName,
  validateHomeAgentDrift as libValidateHomeAgentDrift,
  type GuidanceReadMode,
  type GuidanceEntry,
} from "../lib/agent-guidance-files.ts";

export type GuidanceViolation = { rule: string; path: string; message: string };

export function claudeCompatibilityPath(agentPath: string): string {
  return libClaudeCompatibilityPath(agentPath);
}

export function validateHomeAgentDrift(
  personalAgentContent: string | undefined,
  liveContent: string | undefined,
  homeAgentPath?: string,
): GuidanceViolation | undefined {
  return libValidateHomeAgentDrift(
    personalAgentContent,
    liveContent,
    homeAgentPath,
  );
}

type LinkExpectation = Readonly<{ path: string; target: string; rule: string }>;
function validateSymlink(
  entries: ReadonlyMap<string, GuidanceEntry>,
  expectation: LinkExpectation,
): GuidanceViolation | undefined {
  const entry = entries.get(expectation.path);
  const targetPath = gitPath.normalize(
    gitPath.join(gitPath.dirname(expectation.path), expectation.target),
  );
  if (
    entry?.kind !== "symlink" ||
    entry.contents !== expectation.target ||
    !hasPathOrDescendant(entries, targetPath)
  ) {
    return {
      rule: expectation.rule,
      path: expectation.path,
      message: `must be a symlink to existing ${expectation.target}`,
    };
  }
  return undefined;
}
function validateSourceAdapter(
  entries: ReadonlyMap<string, GuidanceEntry>,
  entryPath: string,
  expected: string,
): GuidanceViolation | undefined {
  const entry = entries.get(entryPath);
  if (entry?.kind !== "file" || entry.contents.trim() !== expected) {
    return {
      rule: "source-adapter",
      path: entryPath,
      message: `chezmoi symlink source must contain ${expected}`,
    };
  }
  return undefined;
}
function addWhenPresent(
  violations: GuidanceViolation[],
  violation: GuidanceViolation | undefined,
): void {
  if (violation !== undefined) violations.push(violation);
}
function validateClientLayout(
  byPath: ReadonlyMap<string, GuidanceEntry>,
): GuidanceViolation[] {
  const violations: GuidanceViolation[] = [];
  for (const [entryPath, expected] of ROOT_SYMLINKS) {
    addWhenPresent(
      violations,
      validateSymlink(byPath, {
        path: entryPath,
        target: expected,
        rule: "repository-symlink",
      }),
    );
  }
  for (const [entryPath, expected] of REQUIRED_SOURCE_ADAPTERS) {
    addWhenPresent(
      violations,
      validateSourceAdapter(byPath, entryPath, expected),
    );
  }
  if (byPath.get(PERSONAL_AGENT_PATH)?.kind !== "file") {
    violations.push({
      rule: "source-adapter-target",
      path: PERSONAL_AGENT_PATH,
      message: "required source adapters need the canonical personal AGENTS.md",
    });
  }
  if (!hasPathOrDescendant(byPath, PERSONAL_SKILLS_PATH)) {
    violations.push({
      rule: "source-adapter-target",
      path: PERSONAL_SKILLS_PATH,
      message:
        "required skill adapters need the canonical personal skill catalog",
    });
  }
  const cursorAdapter = byPath.get(CURSOR_ADAPTER_PATH);
  if (
    cursorAdapter?.kind !== "file" ||
    cursorAdapter.contents.trim() !== CURSOR_ADAPTER_CONTENT
  ) {
    violations.push({
      rule: "cursor-adapter",
      path: CURSOR_ADAPTER_PATH,
      message: "must be a minimal pointer to ~/AGENTS.md",
    });
  }
  return violations;
}
function validateClientSpecificEntry(
  entry: GuidanceEntry,
): GuidanceViolation[] {
  const violations: GuidanceViolation[] = [];
  const parts = entry.path.split("/");
  const clientSkillCopy = parts.some(
    (part, index) =>
      (CLIENT_SKILL_DIRECTORIES.has(part) && parts[index + 1] === "skills") ||
      (GEMINI_SKILL_DIRECTORIES.has(part) &&
        parts[index + 1] === "config" &&
        parts[index + 2] === "skills"),
  );
  if (clientSkillCopy) {
    violations.push({
      rule: "duplicate-client-skill",
      path: entry.path,
      message: "client-specific skill copies are not allowed",
    });
  }
  if (
    gitPath.basename(entry.path) === "GEMINI.md" &&
    entry.path !== GEMINI_SOURCE_ADAPTER_PATH
  ) {
    violations.push({
      rule: "repository-gemini-guidance",
      path: entry.path,
      message: "repository guidance belongs in AGENTS.md or .agents/skills",
    });
  }
  if (
    (entry.path.startsWith(".cursor/rules/") ||
      entry.path.includes("/.cursor/rules/") ||
      entry.path.startsWith("dot_cursor/rules/") ||
      entry.path.includes("/dot_cursor/rules/") ||
      entry.path.startsWith("private_dot_cursor/rules/") ||
      entry.path.includes("/private_dot_cursor/rules/")) &&
    entry.path !== CURSOR_ADAPTER_PATH
  ) {
    violations.push({
      rule: "repository-cursor-rule",
      path: entry.path,
      message: "repository guidance belongs in AGENTS.md or .agents/skills",
    });
  }
  return violations;
}
function validateAgentEntry(
  entry: GuidanceEntry,
  byPath: ReadonlyMap<string, GuidanceEntry>,
): GuidanceViolation[] {
  const violations: GuidanceViolation[] = [];
  const rootBudget = ROOT_AGENT_PATHS.has(entry.path);
  addBudgetViolations(
    entry,
    {
      lineRule: rootBudget ? "root-agent-lines" : "nested-agent-lines",
      byteRule: rootBudget ? "root-agent-bytes" : "nested-agent-bytes",
      maxLines: rootBudget ? ROOT_AGENT_MAX_LINES : AGENT_MAX_LINES,
      maxBytes: rootBudget ? ROOT_AGENT_MAX_BYTES : AGENT_MAX_BYTES,
    },
    violations,
  );
  const claudePath = claudeCompatibilityPath(entry.path);
  addWhenPresent(
    violations,
    validateSymlink(byPath, {
      path: claudePath,
      target: "AGENTS.md",
      rule: "claude-compatibility",
    }),
  );
  return violations;
}
type SkillRegistry = Readonly<{
  ids: Map<string, string>;
  catalogSizes: Map<string, number>;
}>;
function validateSkillMetadata(
  entry: GuidanceEntry,
  registry: SkillRegistry,
): GuidanceViolation[] {
  const violations: GuidanceViolation[] = [];
  const frontmatter = parseSkillFrontmatter(entry);
  if (frontmatter === undefined) {
    return [
      {
        rule: "skill-frontmatter",
        path: entry.path,
        message: "requires parseable YAML name and description frontmatter",
      },
    ];
  }
  if (!SKILL_ID.test(frontmatter.name) || frontmatter.name.length > 63) {
    violations.push({
      rule: "skill-id",
      path: entry.path,
      message: "name must be lowercase kebab-case and at most 63 characters",
    });
  }
  if (frontmatter.name !== skillDirectoryName(entry.path)) {
    violations.push({
      rule: "skill-directory",
      path: entry.path,
      message: `name ${frontmatter.name} must match its directory`,
    });
  }
  if (frontmatter.description.length > 1024) {
    violations.push({
      rule: "skill-description",
      path: entry.path,
      message: "description must be at most 1024 characters",
    });
  }
  if (!isGlobalReferenceSkill(entry.path)) {
    const unsupported = frontmatter.keys.filter(
      (key) => !PORTABLE_SKILL_FIELDS.has(key),
    );
    if (unsupported.length > 0) {
      violations.push({
        rule: "skill-frontmatter-portability",
        path: entry.path,
        message: `unsupported fields: ${unsupported.join(", ")}`,
      });
    }
  }
  const priorPath = registry.ids.get(frontmatter.name);
  if (priorPath === undefined) {
    registry.ids.set(frontmatter.name, entry.path);
  } else {
    violations.push({
      rule: "duplicate-skill-id",
      path: entry.path,
      message: `duplicates ${priorPath}`,
    });
  }
  const root = catalogRoot(entry.path);
  if (root !== undefined) {
    const catalogBytes = byteCount(
      `${frontmatter.name}\n${frontmatter.description}\n`,
    );
    registry.catalogSizes.set(
      root,
      (registry.catalogSizes.get(root) ?? 0) + catalogBytes,
    );
  }
  return violations;
}
function validateSkillEntry(
  entry: GuidanceEntry,
  registry: SkillRegistry,
): GuidanceViolation[] {
  const violations: GuidanceViolation[] = [];
  if (isGlobalReferenceSkill(entry.path)) {
    return validateSkillMetadata(entry, registry);
  }
  addBudgetViolations(
    entry,
    {
      lineRule: "skill-lines",
      byteRule: "skill-bytes",
      maxLines: SKILL_MAX_LINES,
      maxBytes: SKILL_MAX_BYTES,
    },
    violations,
  );
  violations.push(...validateSkillMetadata(entry, registry));
  return violations;
}
function validateCatalogSizes(
  catalogSizes: ReadonlyMap<string, number>,
): GuidanceViolation[] {
  const violations: GuidanceViolation[] = [];
  for (const [root, bytes] of catalogSizes) {
    if (bytes > CATALOG_MAX_BYTES) {
      violations.push({
        rule: "skill-catalog-bytes",
        path: root,
        message: `${bytes.toString()} bytes exceeds ${CATALOG_MAX_BYTES.toString()}`,
      });
    }
  }
  return violations;
}
export type ValidateAgentGuidanceOptions = Readonly<{
  homeAgentPath?: string | undefined;
  liveContent?: string | undefined;
}>;

export function validateAgentGuidance(
  inputEntries: readonly GuidanceEntry[],
  options?: ValidateAgentGuidanceOptions,
): GuidanceViolation[] {
  const entries = inputEntries.filter((entry) => !isArchived(entry.path));
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const registry: SkillRegistry = {
    ids: new Map<string, string>(),
    catalogSizes: new Map<string, number>(),
  };
  const violations = validateClientLayout(byPath);
  if (options?.liveContent !== undefined) {
    const personalEntry = byPath.get(PERSONAL_AGENT_PATH);
    addWhenPresent(
      violations,
      validateHomeAgentDrift(
        personalEntry?.contents,
        options.liveContent,
        options.homeAgentPath ?? "~/AGENTS.md",
      ),
    );
  }
  for (const entry of entries) {
    if (entry.path !== ".claude/skills") {
      violations.push(...validateClientSpecificEntry(entry));
    }
    if (entry.path.endsWith("/AGENTS.md") || entry.path === "AGENTS.md") {
      violations.push(...validateAgentEntry(entry, byPath));
    }
    if (entry.path.endsWith("/CLAUDE.md") || entry.path === "CLAUDE.md") {
      addWhenPresent(
        violations,
        validateSymlink(byPath, {
          path: entry.path,
          target: "AGENTS.md",
          rule: "claude-compatibility",
        }),
      );
    }
    if (isSkill(entry.path)) {
      violations.push(...validateSkillEntry(entry, registry));
    }
  }
  violations.push(...validateCatalogSizes(registry.catalogSizes));
  return violations.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.rule.localeCompare(right.rule),
  );
}
export async function checkAgentGuidance(
  readMode: GuidanceReadMode = "worktree",
  options?: ValidateAgentGuidanceOptions,
): Promise<void> {
  const extraTrackedPaths = new Set([
    ...REQUIRED_SOURCE_ADAPTERS.keys(),
    "packages/dotfiles/private_dot_cursor/rules/agent-guidance.mdc",
  ]);
  const entries = await listGuidanceEntries(
    extraTrackedPaths,
    undefined,
    readMode,
  );
  const homeAgentPath =
    options?.homeAgentPath ?? path.join(os.homedir(), "AGENTS.md");
  let liveContent = options?.liveContent;
  if (liveContent === undefined) {
    const homeFile = Bun.file(homeAgentPath);
    if (await homeFile.exists()) {
      liveContent = await homeFile.text();
    }
  }
  const violations = validateAgentGuidance(entries, {
    homeAgentPath,
    liveContent,
  });
  if (violations.length > 0) {
    throw new Error(
      `Agent guidance guard failed:\n${violations
        .map(
          (violation) =>
            `- ${violation.path} [${violation.rule}] ${violation.message}`,
        )
        .join("\n")}`,
    );
  }
  console.log("Agent guidance valid:", entries.length);
}
if (import.meta.main) {
  const readMode = process.argv.includes("--staged") ? "index" : "worktree";
  await checkAgentGuidance(readMode);
}
