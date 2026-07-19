#!/usr/bin/env bun

import { mkdir, rename } from "node:fs/promises";

import {
  parseLooseFrontmatter,
  parseMarkdownBody,
  serializeMarkdownDocument,
  splitFrontmatter,
} from "#shared/markdown";
import {
  DispositionSchema,
  DocumentStatusSchema,
  DocumentTypeSchema,
  FrontmatterSchema,
  VerificationSchema,
  type DocumentFrontmatter,
  type DocumentStatus,
} from "#shared/schema";

const REPO_ROOT = decodeURIComponent(
  new URL("../../../..", import.meta.url).pathname.replace(/\/$/, ""),
);
const DOCS_ROOT = `${REPO_ROOT}/packages/docs`;
const DRY_RUN = Bun.argv.includes("--dry-run");
const CHECK = Bun.argv.includes("--check");

type MigrationResult = {
  relativePath: string;
  targetRelativePath: string;
  content: string;
  changed: boolean;
};

function slugify(value: string): string {
  return value
    .replace(/\.md$/u, "")
    .replaceAll("_", "-")
    .replaceAll("/", "-")
    .replaceAll(/[^a-zA-Z0-9-]+/gu, "-")
    .replaceAll(/-+/gu, "-")
    .replaceAll(/^-|-$/gu, "")
    .toLowerCase();
}

function titleFromPath(relativePath: string): string {
  const basename = relativePath.split("/").at(-1)?.replace(/\.md$/u, "");
  if (basename === undefined) return "Untitled Document";
  if (basename === "AGENTS") return "Documentation Agent Guidance";
  if (basename === "index") return "Documentation Index";
  const withoutDate = basename.replace(/^\d{4}-\d{2}-\d{2}_/u, "");
  return withoutDate
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replaceAll(/\b\w/gu, (character) => character.toUpperCase());
}

function inferType(relativePath: string): DocumentFrontmatter["type"] {
  const directory = relativePath.split("/")[0];
  const result = DocumentTypeSchema.safeParse(
    directory === "decisions"
      ? "decision"
      : directory === "guides"
        ? "guide"
        : directory === "logs"
          ? "log"
          : directory === "patterns"
            ? "pattern"
            : directory === "plans"
              ? "plan"
              : directory === "todos"
                ? "todo"
                : directory === "architecture"
                  ? "architecture"
                  : "reference",
  );
  if (!result.success) throw new Error(`cannot infer type for ${relativePath}`);
  return result.data;
}

function extractStatusText(body: string): string {
  const metadata = parseMarkdownBody(body);
  const statusIndex = metadata.headings.findIndex(
    (heading) => heading.depth === 2 && heading.text === "Status",
  );
  if (statusIndex === -1) return "";
  const statusHeading = metadata.headings[statusIndex];
  if (statusHeading === undefined) return "";
  const nextHeading = metadata.headings
    .slice(statusIndex + 1)
    .find((heading) => heading.depth <= 2);
  return body
    .split("\n")
    .slice(statusHeading.endLine, (nextHeading?.startLine ?? Infinity) - 1)
    .join(" ")
    .replaceAll(/[*_`#]/gu, "")
    .trim();
}

type StatusInference = {
  existingStatus: string | undefined;
  statusText: string;
  type: DocumentFrontmatter["type"];
  relativePath: string;
  body: string;
};

function inferStatus(input: StatusInference): DocumentStatus {
  const { existingStatus, statusText, type, relativePath, body } = input;
  const canonical = DocumentStatusSchema.safeParse(existingStatus);
  if (canonical.success) return canonical.data;
  if (relativePath.startsWith("archive/")) return "complete";
  if (type !== "plan" && type !== "todo") return "complete";

  if (type === "todo") {
    if (existingStatus === "waiting-on-verification") return "awaiting-human";
    if (existingStatus === "resolved") return "complete";
    return existingStatus === "active" ? "in-progress" : "planned";
  }

  const value = `${existingStatus ?? ""} ${statusText}`.trim().toLowerCase();
  const pending =
    /await|pending|not yet merged|pr open|post[- ]deploy|live (?:test|verification)|human (?:test|verification)/u.test(
      value,
    );
  const uncheckedTasks = body.match(/^\s*[-*] \[ \]/gmu)?.length ?? 0;
  if (/^(?:not started|planned|proposed)/u.test(value)) return "planned";
  if (/^(?:in progress|partially?|active)/u.test(value)) {
    return "in-progress";
  }
  if (/^(?:complete|implemented|done|shipped|resolved)/u.test(value)) {
    if (pending) return "awaiting-human";
    return uncheckedTasks === 0 ? "complete" : "in-progress";
  }
  if (pending && /complete|implemented|done|shipped/u.test(value)) {
    return "awaiting-human";
  }
  if (/implementation complete|code complete/u.test(value)) {
    return "in-progress";
  }
  return "planned";
}

function normalizeH1(body: string, fallbackTitle: string): string {
  let normalized = body.trimStart();
  let metadata = parseMarkdownBody(normalized);
  if (metadata.h1Count === 0) {
    normalized = `# ${fallbackTitle}\n\n${normalized}`;
    metadata = parseMarkdownBody(normalized);
  }
  if (metadata.h1Count <= 1) return normalized;
  const lines = normalized.split("\n");
  const extraH1s = metadata.headings.filter(
    (heading, index) =>
      heading.depth === 1 &&
      index !==
        metadata.headings.findIndex((candidate) => candidate.depth === 1),
  );
  for (const heading of extraH1s) {
    const lineIndex = heading.startLine - 1;
    const line = lines[lineIndex];
    if (line === undefined) continue;
    if (line.startsWith("# ")) {
      lines[lineIndex] = `#${line}`;
      continue;
    }
    const underlineIndex = heading.endLine;
    const underline = lines[underlineIndex];
    if (underline !== undefined && /^=+\s*$/u.test(underline)) {
      lines[underlineIndex] = underline.replaceAll("=", "-");
    }
  }
  return lines.join("\n");
}

function normalizeStatusSection(body: string): string {
  const metadata = parseMarkdownBody(body);
  const index = metadata.headings.findIndex(
    (heading) => heading.depth === 2 && heading.text === "Status",
  );
  if (index === -1) return body;
  const heading = metadata.headings[index];
  if (heading === undefined) return body;
  const next = metadata.headings
    .slice(index + 1)
    .find((candidate) => candidate.depth <= 2);
  const lines = body.split("\n");
  const sectionEnd = (next?.startLine ?? lines.length + 1) - 1;
  const content = lines
    .slice(heading.endLine, sectionEnd)
    .filter((line) => line.trim() !== "");
  if (content.length <= 3 && content.join(" ").length <= 400) {
    lines.splice(heading.startLine - 1, sectionEnd - heading.startLine + 1);
    return lines.join("\n").replaceAll(/\n{3,}/gu, "\n\n");
  }
  lines[heading.startLine - 1] = "## Status Notes (Historical)";
  return lines.join("\n");
}

function headingMatches(text: string, awaitingHuman: boolean): boolean {
  const value = text.toLowerCase();
  if (awaitingHuman) {
    return (
      value === "human verification" ||
      value === "done when" ||
      value === "to verify" ||
      value === "remaining" ||
      value.startsWith("verification") ||
      value.startsWith("verify after")
    );
  }
  return (
    value === "remaining" ||
    value === "done when" ||
    value === "remaining steps" ||
    value.startsWith("remaining steps ") ||
    value === "what to do" ||
    value === "steps" ||
    value === "how to unblock"
  );
}

function normalizeWorkflowSection(
  body: string,
  status: DocumentStatus,
  board: boolean,
  title: string,
): string {
  if (!board || status === "complete") return body;
  const awaitingHuman = status === "awaiting-human";
  const target = awaitingHuman ? "Human Verification" : "Remaining";
  let metadata = parseMarkdownBody(body);
  const candidate = metadata.headings.find(
    (heading) =>
      heading.depth === 2 && headingMatches(heading.text, awaitingHuman),
  );
  let lines = body.split("\n");
  if (candidate === undefined) {
    const defaultItem = awaitingHuman
      ? `- Verify \`${title}\` in its intended environment and record evidence in the Comment Log.`
      : `- [ ] Complete and verify the work described in \`${title}\`.`;
    return `${body.trimEnd()}\n\n## ${target}\n\n${defaultItem}\n`;
  }
  lines[candidate.startLine - 1] = `## ${target}`;
  let normalized = lines.join("\n");
  metadata = parseMarkdownBody(normalized);
  const sectionIndex = metadata.headings.findIndex(
    (heading) => heading.depth === 2 && heading.text === target,
  );
  const section = metadata.headings[sectionIndex];
  if (section === undefined) return normalized;
  const next = metadata.headings
    .slice(sectionIndex + 1)
    .find((heading) => heading.depth <= 2);
  lines = normalized.split("\n");
  const end = (next?.startLine ?? lines.length + 1) - 1;
  for (let index = section.endLine; index < end; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    if (awaitingHuman) {
      lines[index] = line
        .replace(/^(\s*[-*]) \[[ x]\] /iu, "$1 ")
        .replace(/^(\s*)\d+\. /u, "$1- ")
        .replace(/^(\s*[-*]) ✅ /u, "$1 ");
    } else if (/^\s*[-*] (?!\[[ x]\] )/iu.test(line)) {
      lines[index] = line.replace(/^(\s*[-*]) /u, "$1 [ ] ");
    } else if (/^\s*\d+\. /u.test(line)) {
      lines[index] = line.replace(/^(\s*)\d+\. /u, "$1- [ ] ");
    }
  }
  normalized = lines.join("\n");
  return normalized;
}

function getPlainString(
  values: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

function getBoolean(
  values: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = values[key];
  return typeof value === "boolean" ? value : undefined;
}

export function createFrontmatter(
  relativePath: string,
  loose: Record<string, unknown>,
  body: string,
): DocumentFrontmatter {
  const type = inferType(relativePath);
  const existingId = getPlainString(loose, "id");
  const basename = relativePath.split("/").at(-1)?.replace(/\.md$/u, "");
  const pathSegments = relativePath.split("/");
  const idPath =
    pathSegments.length > 1 ? pathSegments.slice(1).join("/") : relativePath;
  const generatedId =
    type === "todo" && basename !== undefined
      ? basename
      : `${type}-${slugify(idPath)}`;
  const id = existingId ?? generatedId;
  const existingStatus = getPlainString(loose, "status");
  const status = inferStatus({
    existingStatus,
    statusText: extractStatusText(body),
    type,
    relativePath,
    body,
  });
  const existingBoard = getBoolean(loose, "board");
  const board =
    existingBoard ??
    (type === "todo" ||
      (type === "plan" && !relativePath.startsWith("archive/")));
  const candidate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(loose)) {
    if (
      ![
        "id",
        "type",
        "status",
        "board",
        "verification",
        "disposition",
        "origin",
        "source_marker",
      ].includes(key)
    ) {
      candidate[key] = value;
    }
  }
  candidate["id"] = id;
  candidate["type"] = type;
  candidate["status"] = status;
  candidate["board"] = board;
  const origin = getPlainString(loose, "origin");
  if (origin !== undefined) candidate["origin"] = origin;
  const sourceMarker = getBoolean(loose, "source_marker");
  if (sourceMarker !== undefined) candidate["source_marker"] = sourceMarker;
  if (board) {
    const existingVerification = VerificationSchema.safeParse(
      getPlainString(loose, "verification"),
    );
    candidate["verification"] =
      status === "awaiting-human"
        ? "human"
        : existingVerification.success
          ? existingVerification.data
          : "agent";
    const existingDisposition = DispositionSchema.safeParse(
      getPlainString(loose, "disposition"),
    );
    candidate["disposition"] = existingDisposition.success
      ? existingDisposition.data
      : existingStatus === "blocked"
        ? "blocked"
        : existingStatus === "deferred"
          ? "deferred"
          : "active";
  }
  return FrontmatterSchema.parse(candidate);
}

async function migrateFile(relativePath: string): Promise<MigrationResult> {
  const absolutePath = `${DOCS_ROOT}/${relativePath}`;
  const raw = await Bun.file(absolutePath).text();
  const split = splitFrontmatter(raw);
  const loose = split === null ? {} : parseLooseFrontmatter(split.yaml);
  let body = split?.body ?? raw;
  const fallbackTitle = titleFromPath(relativePath);
  body = normalizeH1(body, fallbackTitle);
  const metadata = parseMarkdownBody(body);
  const title = metadata.title ?? fallbackTitle;
  const frontmatter = createFrontmatter(relativePath, loose, body);
  body = normalizeStatusSection(body);
  body = normalizeWorkflowSection(
    body,
    frontmatter.status,
    frontmatter.board,
    title,
  );
  const content = serializeMarkdownDocument(frontmatter, body);
  const shouldArchive =
    frontmatter.status === "complete" &&
    (frontmatter.type === "plan" || frontmatter.type === "todo") &&
    !relativePath.startsWith("archive/") &&
    frontmatter.source_marker !== true;
  const targetRelativePath = shouldArchive
    ? `archive/completed/${relativePath.split("/").at(-1) ?? relativePath}`
    : relativePath;
  return {
    relativePath,
    targetRelativePath,
    content,
    changed: content !== raw || targetRelativePath !== relativePath,
  };
}

export async function migrateDocs(): Promise<MigrationResult[]> {
  const glob = new Bun.Glob("**/*.md");
  const paths = [...glob.scanSync({ cwd: DOCS_ROOT, onlyFiles: true })].sort();
  const results: MigrationResult[] = [];
  for (const relativePath of paths) {
    results.push(await migrateFile(relativePath));
  }
  const ids = new Map<string, string>();
  for (const result of results) {
    const parsed = splitFrontmatter(result.content);
    if (parsed === null)
      throw new Error(`${result.relativePath}: no frontmatter`);
    const frontmatter = FrontmatterSchema.parse(
      parseLooseFrontmatter(parsed.yaml),
    );
    const previous = ids.get(frontmatter.id);
    if (previous !== undefined) {
      throw new Error(
        `duplicate id '${frontmatter.id}' in ${previous} and ${result.relativePath}`,
      );
    }
    ids.set(frontmatter.id, result.relativePath);
  }
  return results;
}

async function main(): Promise<void> {
  const results = await migrateDocs();
  const changed = results.filter((result) => result.changed);
  if (DRY_RUN || CHECK) {
    for (const result of changed) {
      const move =
        result.relativePath === result.targetRelativePath
          ? ""
          : ` -> ${result.targetRelativePath}`;
      console.log(`${result.relativePath}${move}`);
    }
    console.log(
      `migrate-docs: ${String(changed.length)} of ${String(results.length)} documents would change`,
    );
    if (CHECK && changed.length > 0) process.exit(1);
    return;
  }
  for (const result of changed) {
    const source = `${DOCS_ROOT}/${result.relativePath}`;
    const target = `${DOCS_ROOT}/${result.targetRelativePath}`;
    if (source !== target && (await Bun.file(target).exists())) {
      throw new Error(
        `archive target already exists: ${result.targetRelativePath}`,
      );
    }
    await Bun.write(source, result.content);
    if (source !== target) {
      await mkdir(`${DOCS_ROOT}/archive/completed`, { recursive: true });
      await rename(source, target);
    }
  }
  console.log(
    `migrate-docs: updated ${String(changed.length)} of ${String(results.length)} documents`,
  );
}

if (import.meta.main) await main();
