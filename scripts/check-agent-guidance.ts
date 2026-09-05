#!/usr/bin/env bun

import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

import {
  listGuidanceEntries,
  type GuidanceEntry,
} from "./lib/agent-guidance-files.ts";

export type GuidanceViolation = Readonly<{
  rule: string;
  path: string;
  message: string;
}>;

const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});
const PORTABLE_SKILL_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROOT_AGENT_PATHS = new Set(["AGENTS.md", "packages/dotfiles/AGENTS.md"]);
const ARCHIVE_PREFIX = "sandbox/archive/";
const AGENT_MAX_LINES = 120;
const AGENT_MAX_BYTES = 8 * 1024;
const ROOT_AGENT_MAX_LINES = 200;
const ROOT_AGENT_MAX_BYTES = 16 * 1024;
const SKILL_MAX_LINES = 160;
const SKILL_MAX_BYTES = 12 * 1024;
const CATALOG_MAX_BYTES = 8 * 1024;
const gitPath = path.posix;

const REQUIRED_SOURCE_ADAPTERS = new Map([
  ["packages/dotfiles/dot_claude/symlink_CLAUDE.md", "../AGENTS.md"],
  ["packages/dotfiles/dot_claude/symlink_skills", "../.agents/skills"],
  ["packages/dotfiles/private_dot_codex/symlink_AGENTS.md", "../AGENTS.md"],
  ["packages/dotfiles/dot_gemini/symlink_GEMINI.md", "../AGENTS.md"],
  [
    "packages/dotfiles/dot_gemini/config/symlink_skills",
    "../../.agents/skills",
  ],
]);

const ROOT_SYMLINKS = new Map([
  ["CLAUDE.md", "AGENTS.md"],
  [".claude/skills", "../.agents/skills"],
]);

function lineCount(contents: string): number {
  if (contents === "") return 0;
  const count = contents.split(/\r?\n/).length;
  return contents.endsWith("\n") ? count - 1 : count;
}

function byteCount(contents: string): number {
  return new TextEncoder().encode(contents).byteLength;
}

function isArchived(entryPath: string): boolean {
  return entryPath.startsWith(ARCHIVE_PREFIX);
}

function isSkill(entryPath: string): boolean {
  return entryPath.endsWith("/SKILL.md");
}

function isGlobalReferenceSkill(entryPath: string): boolean {
  return entryPath.startsWith("packages/dotfiles/dot_agents/skills/");
}

function skillDirectoryName(entryPath: string): string {
  return gitPath.basename(gitPath.dirname(entryPath));
}

export function claudeCompatibilityPath(agentPath: string): string {
  return gitPath.join(gitPath.dirname(agentPath), "CLAUDE.md");
}

function catalogRoot(entryPath: string): string | undefined {
  const marker = "/.agents/skills/";
  if (entryPath.startsWith(".agents/skills/")) return ".agents/skills";
  const index = entryPath.indexOf(marker);
  if (index === -1) return undefined;
  return entryPath.slice(0, index + marker.length - 1);
}

function parseSkillFrontmatter(
  entry: GuidanceEntry,
):
  | Readonly<
      z.infer<typeof SkillFrontmatterSchema> & { keys: readonly string[] }
    >
  | undefined {
  if (!entry.contents.startsWith("---\n")) return undefined;
  const closing = entry.contents.indexOf("\n---\n", 4);
  if (closing === -1) return undefined;
  try {
    const parsed = z
      .record(z.string(), z.unknown())
      .parse(parse(entry.contents.slice(4, closing)));
    return {
      ...SkillFrontmatterSchema.parse(parsed),
      keys: Object.keys(parsed),
    };
  } catch {
    return undefined;
  }
}

function addBudgetViolations(
  entry: GuidanceEntry,
  values: Readonly<{
    lineRule: string;
    byteRule: string;
    maxLines: number;
    maxBytes: number;
  }>,
  violations: GuidanceViolation[],
): void {
  const lines = lineCount(entry.contents);
  const bytes = byteCount(entry.contents);
  if (lines > values.maxLines) {
    violations.push({
      rule: values.lineRule,
      path: entry.path,
      message: `${lines.toString()} lines exceeds ${values.maxLines.toString()}`,
    });
  }
  if (bytes > values.maxBytes) {
    violations.push({
      rule: values.byteRule,
      path: entry.path,
      message: `${bytes.toString()} bytes exceeds ${values.maxBytes.toString()}`,
    });
  }
}

type LinkExpectation = Readonly<{
  path: string;
  target: string;
  rule: string;
}>;

function validateSymlink(
  entries: ReadonlyMap<string, GuidanceEntry>,
  expectation: LinkExpectation,
): GuidanceViolation | undefined {
  const entry = entries.get(expectation.path);
  if (entry?.kind !== "symlink" || entry.contents !== expectation.target) {
    return {
      rule: expectation.rule,
      path: expectation.path,
      message: `must be a symlink to ${expectation.target}`,
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

  const cursorAdapter = byPath.get(
    "packages/dotfiles/private_dot_cursor/rules/agent-guidance.mdc",
  );
  if (
    cursorAdapter?.kind !== "file" ||
    !cursorAdapter.contents.includes("~/AGENTS.md") ||
    byteCount(cursorAdapter.contents) > 1024
  ) {
    violations.push({
      rule: "cursor-adapter",
      path: "packages/dotfiles/private_dot_cursor/rules/agent-guidance.mdc",
      message: "must be a minimal pointer to ~/AGENTS.md",
    });
  }
  return violations;
}

function validateClientSpecificEntry(
  entry: GuidanceEntry,
): GuidanceViolation[] {
  const violations: GuidanceViolation[] = [];
  if (
    entry.path.startsWith(".claude/skills/") ||
    entry.path.startsWith(".cursor/skills/") ||
    entry.path.startsWith(".opencode/skills/")
  ) {
    violations.push({
      rule: "duplicate-client-skill",
      path: entry.path,
      message: "client-specific skill copies are not allowed",
    });
  }

  if (
    entry.path.startsWith(".cursor/rules/") ||
    entry.path.includes("/.cursor/rules/")
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

export function validateAgentGuidance(
  inputEntries: readonly GuidanceEntry[],
): GuidanceViolation[] {
  const entries = inputEntries.filter((entry) => !isArchived(entry.path));
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const registry: SkillRegistry = {
    ids: new Map<string, string>(),
    catalogSizes: new Map<string, number>(),
  };
  const violations = validateClientLayout(byPath);

  for (const entry of entries) {
    if (entry.path !== ".claude/skills") {
      violations.push(...validateClientSpecificEntry(entry));
    }
    if (entry.path.endsWith("/AGENTS.md") || entry.path === "AGENTS.md") {
      violations.push(...validateAgentEntry(entry, byPath));
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

export async function checkAgentGuidance(): Promise<void> {
  const extraTrackedPaths = new Set([
    ...REQUIRED_SOURCE_ADAPTERS.keys(),
    "packages/dotfiles/private_dot_cursor/rules/agent-guidance.mdc",
  ]);
  const entries = await listGuidanceEntries(extraTrackedPaths);
  const violations = validateAgentGuidance(entries);
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
  console.log(
    `Agent guidance: ${entries.length.toString()} active files satisfy placement, compatibility, and budget rules`,
  );
}

if (import.meta.main) await checkAgentGuidance();
