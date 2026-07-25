#!/usr/bin/env bun

import { z } from "zod";

import {
  parseMarkdownDocument,
  parseLooseFrontmatter,
  splitFrontmatter,
} from "#shared/markdown";
import type { ParsedMarkdownDocument } from "#shared/markdown";
import { FrontmatterSchema } from "#shared/schema";

const REPO_ROOT = decodeURIComponent(
  new URL("../../../..", import.meta.url).pathname.replace(/\/$/, ""),
);
const DOCS_ROOT = `${REPO_ROOT}/packages/docs`;
const ErrorSchema = z.instanceof(Error);
const MarkerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

type SourceMarker = {
  id: string;
  path: string;
  line: number;
};

type ValidationError = {
  path: string;
  message: string;
};

type ValidationContext = {
  errors: ValidationError[];
  ids: Map<string, string>;
  todoDocs: Map<string, { path: string; sourceMarker: boolean }>;
};

function errorMessage(error: unknown): string {
  const result = ErrorSchema.safeParse(error);
  return result.success ? result.data.message : "unknown validation error";
}

async function scanSourceMarkers(): Promise<SourceMarker[]> {
  const pattern = String.raw`(TODO|FIXME|XXX)\(todo:[a-z0-9][a-z0-9-]*\)`;
  const process = Bun.spawn(
    [
      "rg",
      "--no-heading",
      "--line-number",
      "--color=never",
      "--glob",
      "!sandbox/archive/**",
      "--glob",
      "!**/node_modules/**",
      "--glob",
      "!packages/docs/**",
      "--glob",
      "!packages/docs-board/**",
      "--glob",
      "!AGENTS.md",
      "--glob",
      "!CLAUDE.md",
      "-e",
      pattern,
      ".",
    ],
    { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`rg failed (${String(exitCode)}): ${stderr.trim()}`);
  }
  const markers: SourceMarker[] = [];
  for (const rawLine of stdout.split("\n")) {
    if (rawLine.trim() === "") continue;
    const match = /^(.*?):(\d+):(.*)$/u.exec(rawLine);
    if (match === null) continue;
    const path = match[1];
    const lineValue = match[2];
    const content = match[3];
    if (
      path === undefined ||
      lineValue === undefined ||
      content === undefined
    ) {
      continue;
    }
    for (const marker of content.matchAll(
      /(?:TODO|FIXME|XXX)\(todo:([a-z0-9][a-z0-9-]*)\)/gu,
    )) {
      const id = MarkerIdSchema.safeParse(marker[1]);
      if (!id.success) continue;
      markers.push({ id: id.data, path, line: Number(lineValue) });
    }
  }
  return markers;
}

function validateBoard(
  path: string,
  parsed: ParsedMarkdownDocument,
  context: ValidationContext,
): void {
  if (!parsed.frontmatter.board) return;
  if (
    (parsed.frontmatter.status === "planned" ||
      parsed.frontmatter.status === "in-progress") &&
    (!parsed.metadata.hasRemaining || parsed.metadata.remainingCount === 0)
  ) {
    context.errors.push({
      path,
      message: `${parsed.frontmatter.status} board documents require unchecked items in ## Remaining`,
    });
  }
  if (
    parsed.frontmatter.status === "awaiting-human" &&
    (!parsed.metadata.hasHumanVerification ||
      parsed.metadata.remainingCount !== 0)
  ) {
    context.errors.push({
      path,
      message:
        "awaiting-human documents require ## Human Verification and no remaining agent tasks",
    });
  }
  if (
    parsed.frontmatter.status === "complete" &&
    parsed.metadata.remainingCount !== 0
  ) {
    context.errors.push({
      path,
      message: "complete documents cannot have unchecked ## Remaining tasks",
    });
  }
}

function validateParsed(
  path: string,
  parsed: ParsedMarkdownDocument,
  context: ValidationContext,
): void {
  const previous = context.ids.get(parsed.frontmatter.id);
  if (previous === undefined) {
    context.ids.set(parsed.frontmatter.id, path);
  } else {
    context.errors.push({
      path,
      message: `duplicate id '${parsed.frontmatter.id}' also used by ${previous}`,
    });
  }
  if (parsed.metadata.h1Count !== 1) {
    context.errors.push({
      path,
      message: `expected exactly one semantic H1, found ${String(parsed.metadata.h1Count)}`,
    });
  }
  if (
    parsed.metadata.headings.some(
      (heading) => heading.depth === 2 && heading.text === "Status",
    )
  ) {
    context.errors.push({
      path,
      message: "workflow status must live in frontmatter",
    });
  }
  validateBoard(path, parsed, context);
  if (
    path.startsWith("plans/") &&
    parsed.frontmatter.type === "plan" &&
    parsed.frontmatter.status === "complete"
  ) {
    context.errors.push({
      path,
      message: "complete plans must be moved to archive/completed",
    });
  }
  if (parsed.frontmatter.type === "todo") {
    const basename = path.split("/").at(-1)?.replace(/\.md$/u, "");
    if (basename !== parsed.frontmatter.id) {
      context.errors.push({
        path,
        message: `todo filename '${basename ?? ""}' must match id '${parsed.frontmatter.id}'`,
      });
    }
    context.todoDocs.set(parsed.frontmatter.id, {
      path,
      sourceMarker: parsed.frontmatter.source_marker === true,
    });
  }
  if (
    path.startsWith("archive/") &&
    parsed.frontmatter.source_marker === true
  ) {
    context.errors.push({
      path,
      message: "archived documents cannot claim an active source marker",
    });
  }
}

async function validateFile(
  path: string,
  context: ValidationContext,
): Promise<void> {
  const raw = await Bun.file(`${DOCS_ROOT}/${path}`).text();
  try {
    validateParsed(path, parseMarkdownDocument(raw), context);
  } catch (error) {
    const split = splitFrontmatter(raw);
    if (split !== null) {
      try {
        FrontmatterSchema.parse(parseLooseFrontmatter(split.yaml));
      } catch (frontmatterError) {
        context.errors.push({
          path,
          message: `invalid frontmatter: ${errorMessage(frontmatterError)}`,
        });
        return;
      }
    }
    context.errors.push({ path, message: errorMessage(error) });
  }
}

export async function validateDocs(): Promise<ValidationError[]> {
  const glob = new Bun.Glob("**/*.md");
  const paths = [...glob.scanSync({ cwd: DOCS_ROOT, onlyFiles: true })].sort();
  const context: ValidationContext = {
    errors: [],
    ids: new Map<string, string>(),
    todoDocs: new Map<string, { path: string; sourceMarker: boolean }>(),
  };

  for (const path of paths) {
    await validateFile(path, context);
  }

  const markers = await scanSourceMarkers();
  const markersById = new Map<string, SourceMarker[]>();
  for (const marker of markers) {
    const group = markersById.get(marker.id) ?? [];
    group.push(marker);
    markersById.set(marker.id, group);
    if (!context.todoDocs.has(marker.id)) {
      context.errors.push({
        path: marker.path,
        message: `line ${String(marker.line)}: source marker todo:${marker.id} has no matching TODO document`,
      });
    }
  }
  for (const [id, todo] of context.todoDocs) {
    if (todo.sourceMarker && !markersById.has(id)) {
      context.errors.push({
        path: todo.path,
        message: `source_marker: true but TODO(todo:${id}) was not found`,
      });
    }
  }
  return context.errors;
}

async function main(): Promise<void> {
  const errors = await validateDocs();
  if (errors.length > 0) {
    console.error("check-docs: invariants violated\n");
    for (const error of errors) {
      console.error(`  ${error.path}: ${error.message}`);
    }
    console.error(`\n${String(errors.length)} error(s) found`);
    process.exit(1);
  }
  const glob = new Bun.Glob("**/*.md");
  const count = [...glob.scanSync({ cwd: DOCS_ROOT, onlyFiles: true })].length;
  console.log(`check-docs: ${String(count)} Markdown documents, all OK`);
}

if (import.meta.main) await main();
