#!/usr/bin/env bun

/**
 * Enforce the source-marker → doc invariant for packages/docs/todos/.
 *
 * Rules (per AGENTS.md "TODO Documentation"):
 *  - Every `TODO(todo:<id>)`, `FIXME(todo:<id>)`, `XXX(todo:<id>)` source marker
 *    MUST have a matching `packages/docs/todos/<id>.md`.
 *  - Every todo doc with `source_marker: true` MUST have at least one matching
 *    source marker (stale claims are an error).
 *  - Filename id (sans `.md`) MUST equal the frontmatter `id`.
 *  - Frontmatter `status` MUST be one of the documented values.
 *  - Docs without `source_marker: true` may exist freely (general issue tracking).
 */

import { $ } from "bun";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const TODOS_DIR = join(REPO_ROOT, "packages/docs/todos");

const VALID_STATUSES = new Set([
  "active",
  "deferred",
  "blocked",
  "waiting-on-verification",
  "resolved",
]);

const MARKER_REGEX = /(?:TODO|FIXME|XXX)\(todo:([a-z0-9][a-z0-9-]*)\)/g;

interface SourceMarker {
  id: string;
  file: string;
  lineNumber: number;
  line: string;
}

interface TodoDoc {
  id: string;
  file: string;
  frontmatter: Record<string, string | boolean>;
}

interface Error_ {
  kind: string;
  message: string;
}

async function scanSourceMarkers(): Promise<SourceMarker[]> {
  // Use ripgrep for speed; restrict to tracked files. Exclude:
  //   - sandbox/archive/**   (frozen)
  //   - **/node_modules/**   (vendored)
  //   - packages/docs/**     (the convention itself uses the literal text as examples)
  //   - scripts/check-todos.ts (this file's regex source contains the literal pattern)
  //   - AGENTS.md, CLAUDE.md (root convention docs use the literal pattern)
  const excludeGlobs = [
    "!sandbox/archive/**",
    "!**/node_modules/**",
    "!packages/docs/**",
    "!scripts/check-todos.ts",
    "!AGENTS.md",
    "!CLAUDE.md",
  ];
  const globFlags = excludeGlobs.flatMap((g) => ["--glob", g]);
  const pattern = String.raw`(TODO|FIXME|XXX)\(todo:[a-z0-9][a-z0-9-]*\)`;
  const result =
    await $`rg --no-heading --line-number --color=never ${globFlags} -e ${pattern} .`
      .nothrow()
      .quiet();

  // rg exits 1 when there are no matches — not an error.
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`rg failed with exit code ${String(result.exitCode)}`);
  }

  const markers: SourceMarker[] = [];
  const text = result.stdout.toString();
  if (text.trim() === "") return markers;

  for (const rawLine of text.split("\n")) {
    if (rawLine.trim() === "") continue;
    // rg --no-heading format: path:lineNumber:content
    const firstColon = rawLine.indexOf(":");
    if (firstColon === -1) continue;
    const secondColon = rawLine.indexOf(":", firstColon + 1);
    if (secondColon === -1) continue;

    const file = rawLine.slice(0, firstColon);
    const lineNumberStr = rawLine.slice(firstColon + 1, secondColon);
    const content = rawLine.slice(secondColon + 1);
    const lineNumber = Number.parseInt(lineNumberStr, 10);
    if (!Number.isFinite(lineNumber)) continue;

    // A single line may contain multiple markers — capture each.
    MARKER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKER_REGEX.exec(content)) !== null) {
      markers.push({
        id: match[1],
        file,
        lineNumber,
        line: content.trim(),
      });
    }
  }

  return markers;
}

function parseFrontmatter(raw: string): Record<string, string | boolean> {
  // Minimal YAML-ish parser. The convention only allows scalar values
  // (strings + booleans) at the top level of TODO frontmatter, so a
  // line-by-line splitter is sufficient and avoids a runtime dep.
  const lines = raw.split("\n");
  const out: Record<string, string | boolean> = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip optional surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "true") {
      out[key] = true;
    } else if (value === "false") {
      out[key] = false;
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function scanTodoDocs(): Promise<TodoDoc[]> {
  let entries: string[];
  try {
    entries = await readdir(TODOS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const docs: TodoDoc[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (entry === "README.md") continue;
    const file = join(TODOS_DIR, entry);
    const raw = await readFile(file, "utf8");
    if (!raw.startsWith("---")) {
      docs.push({
        id: entry.replace(/\.md$/, ""),
        file,
        frontmatter: {},
      });
      continue;
    }
    const end = raw.indexOf("\n---", 3);
    if (end === -1) {
      docs.push({
        id: entry.replace(/\.md$/, ""),
        file,
        frontmatter: {},
      });
      continue;
    }
    const fm = raw.slice(3, end);
    docs.push({
      id: entry.replace(/\.md$/, ""),
      file,
      frontmatter: parseFrontmatter(fm),
    });
  }
  return docs;
}

function relativize(file: string): string {
  if (file.startsWith(REPO_ROOT + "/")) {
    return file.slice(REPO_ROOT.length + 1);
  }
  return file;
}

async function main(): Promise<void> {
  const [markers, docs] = await Promise.all([
    scanSourceMarkers(),
    scanTodoDocs(),
  ]);

  const docsById = new Map(docs.map((d) => [d.id, d]));
  const markersById = new Map<string, SourceMarker[]>();
  for (const m of markers) {
    const list = markersById.get(m.id) ?? [];
    list.push(m);
    markersById.set(m.id, list);
  }

  const errors: Error_[] = [];

  // 1. Every source marker must have a matching doc.
  for (const m of markers) {
    if (!docsById.has(m.id)) {
      errors.push({
        kind: "missing-doc",
        message: `${m.file}:${String(m.lineNumber)}: source marker 'todo:${m.id}' has no matching packages/docs/todos/${m.id}.md`,
      });
    }
  }

  // 2. Docs that claim source_marker:true must have at least one matching marker.
  for (const doc of docs) {
    if (doc.frontmatter.source_marker === true && !markersById.has(doc.id)) {
      errors.push({
        kind: "stale-source-marker-claim",
        message: `${relativize(doc.file)}: declares 'source_marker: true' but no matching TODO(todo:${doc.id}) found in source`,
      });
    }
  }

  // 3. Filename id must equal frontmatter id (when frontmatter id is set).
  for (const doc of docs) {
    const fmId = doc.frontmatter.id;
    if (fmId !== undefined && fmId !== doc.id) {
      errors.push({
        kind: "id-mismatch",
        message: `${relativize(doc.file)}: filename id '${doc.id}' does not match frontmatter id '${String(fmId)}'`,
      });
    }
  }

  // 4. Frontmatter status must be a documented value.
  for (const doc of docs) {
    const status = doc.frontmatter.status;
    if (status === undefined) {
      errors.push({
        kind: "missing-status",
        message: `${relativize(doc.file)}: missing required frontmatter field 'status'`,
      });
      continue;
    }
    if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
      errors.push({
        kind: "bad-status",
        message: `${relativize(doc.file)}: status '${String(status)}' is not one of: ${[...VALID_STATUSES].join(", ")}`,
      });
    }
  }

  if (errors.length > 0) {
    console.error("check-todos: invariants violated\n");
    for (const e of errors) {
      console.error(`  [${e.kind}] ${e.message}`);
    }
    console.error(
      `\n${String(errors.length)} error${errors.length === 1 ? "" : "s"} found`,
    );
    process.exit(1);
  }

  console.log(
    `check-todos: ${String(markers.length)} source marker${markers.length === 1 ? "" : "s"}, ${String(docs.length)} doc file${docs.length === 1 ? "" : "s"}, all OK`,
  );
}

await main();
