/**
 * Tool runner for knip and jscpd.
 *
 * Executes project-wide analysis tools and parses their JSON output.
 *
 * Performance optimization: If cache files exist (.knip-cache.json, .jscpd-cache.json),
 * the runner will use those instead of running the tools.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";

const KNIP_CACHE_FILE = ".knip-cache.json";
const JSCPD_CACHE_FILE = ".jscpd-cache.json";

export type KnipFileResult = {
  isUnusedFile: boolean;
  unusedExports: {
    symbol: string;
    line?: number;
    col?: number;
  }[];
};

export type KnipResults = Map<string, KnipFileResult>;

/**
 * Walk up from `startDir` to find the monorepo root that owns the knip
 * config — the nearest ancestor directory containing a `knip.json`. Knip 6
 * only reads config from its cwd (it does not search upward), so the rule
 * must run knip from this root and target the linted package via
 * `--workspace`; otherwise knip falls back to its default config and floods
 * every package with false positives.
 */
function findKnipRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(resolve(dir, "knip.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Shape of a single knip 6 issue row. Knip 6 dropped the top-level `files`
 * array from `--reporter json`; an unused file is now a row whose per-issue
 * `files` array is non-empty. Parsed defensively (all fields optional) so a
 * future schema tweak degrades to "no findings" rather than throwing and
 * silently disabling the rule — the exact failure this parser replaces.
 */
type KnipIssueRow = {
  file?: unknown;
  files?: unknown;
  exports?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...value };
  }
  return null;
}

function parseExportEntry(
  value: unknown,
): { symbol: string; line?: number; col?: number } | null {
  const record = asRecord(value);
  if (record === null || typeof record["name"] !== "string") {
    return null;
  }
  const entry: { symbol: string; line?: number; col?: number } = {
    symbol: record["name"],
  };
  if (typeof record["line"] === "number") {
    entry.line = record["line"];
  }
  if (typeof record["col"] === "number") {
    entry.col = record["col"];
  }
  return entry;
}

/**
 * Parse knip's `--reporter json` output (knip 6 shape) into per-file results
 * keyed by absolute path. `basePath` is the directory knip ran in, used to
 * resolve knip's relative `file` paths to absolute — with `--workspace` from
 * the monorepo root, those paths are root-relative.
 *
 * Exported for unit testing so the knip-6 JSON shape is pinned by a fixture.
 */
export function parseKnipOutput(output: string, basePath: string): KnipResults {
  const results: KnipResults = new Map();

  const root = asRecord(JSON.parse(output));
  const issues = root === null ? null : root["issues"];
  if (!Array.isArray(issues)) {
    return results;
  }

  for (const rawIssue of issues) {
    const issue: KnipIssueRow | null = asRecord(rawIssue);
    if (issue === null || typeof issue.file !== "string") {
      continue;
    }
    const absPath = resolve(basePath, issue.file);

    const filesArr = Array.isArray(issue.files) ? issue.files : [];
    const isUnusedFile = filesArr.length > 0;

    const exportsArr = Array.isArray(issue.exports) ? issue.exports : [];
    const unusedExports: KnipFileResult["unusedExports"] = [];
    for (const raw of exportsArr) {
      const entry = parseExportEntry(raw);
      if (entry !== null) {
        unusedExports.push(entry);
      }
    }

    const existing = results.get(absPath);
    if (existing) {
      existing.isUnusedFile ||= isUnusedFile;
      existing.unusedExports.push(...unusedExports);
    } else {
      results.set(absPath, { isUnusedFile, unusedExports });
    }
  }

  return results;
}

function readKnipCache(projectRoot: string): string | null {
  const cachePath = resolve(projectRoot, KNIP_CACHE_FILE);
  if (existsSync(cachePath)) {
    try {
      return readFileSync(cachePath, "utf-8");
    } catch {
      return null;
    }
  }
  return null;
}

export function runKnip(projectRoot: string): KnipResults {
  try {
    const cached = readKnipCache(projectRoot);
    if (cached !== null) {
      // Cache files are written by the linted package itself, so their paths
      // are resolved relative to that package dir.
      return parseKnipOutput(cached, projectRoot);
    }

    const knipRoot = findKnipRoot(projectRoot);
    if (knipRoot === null) {
      console.error(
        "[knip-unused] Could not locate a knip.json above:",
        projectRoot,
      );
      return new Map();
    }

    // Knip 6 resolves config only from its cwd, so run from the config root
    // and scope to the linted package. `--workspace` names are the config's
    // workspace keys, which are POSIX-relative paths from the root.
    const workspace = relative(knipRoot, projectRoot).split(sep).join("/");
    const args =
      workspace === ""
        ? ["knip", "--reporter", "json"]
        : ["knip", "--workspace", workspace, "--reporter", "json"];

    const result = spawnSync("bunx", args, {
      cwd: knipRoot,
      encoding: "utf-8",
      timeout: 120_000,
      shell: false,
    });

    if (result.error) {
      console.error("[knip-unused] Failed to run knip:", result.error.message);
      return new Map();
    }

    const output = result.stdout.trim();
    if (!output) {
      return new Map();
    }

    return parseKnipOutput(output, knipRoot);
  } catch (error) {
    console.error(
      "[knip-unused] Error parsing knip output:",
      error instanceof Error ? error.message : String(error),
    );
    return new Map();
  }
}

type JscpdLocation = {
  name: string;
  start: number;
  end: number;
  startLoc: { line: number; column: number };
  endLoc: { line: number; column: number };
};

type JscpdDuplicate = {
  format: string;
  lines: number;
  tokens: number;
  firstFile: JscpdLocation;
  secondFile: JscpdLocation;
};

type JscpdOutput = {
  duplicates: JscpdDuplicate[];
  statistics: unknown;
};

export type DuplicationInfo = {
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  lines: number;
  otherFile: string;
  otherStartLine: number;
  otherEndLine: number;
};

export type JscpdResults = Map<string, DuplicationInfo[]>;

function readJscpdCache(projectRoot: string): string | null {
  const cachePath = resolve(projectRoot, JSCPD_CACHE_FILE);
  if (existsSync(cachePath)) {
    try {
      return readFileSync(cachePath, "utf-8");
    } catch {
      return null;
    }
  }
  return null;
}

export function runJscpd(projectRoot: string): JscpdResults {
  const results: JscpdResults = new Map();
  let tempDir: string | undefined;

  try {
    const cachedOutput = readJscpdCache(projectRoot);
    let output: string;

    if (cachedOutput === null) {
      tempDir = mkdtempSync(resolve(tmpdir(), "jscpd-"));

      const result = spawnSync(
        "bunx",
        ["jscpd", "--reporters", "json", "--output", tempDir, "."],
        {
          cwd: projectRoot,
          encoding: "utf-8",
          timeout: 180_000,
          shell: false,
        },
      );

      if (result.error) {
        console.error(
          "[no-code-duplication] Failed to run jscpd:",
          result.error.message,
        );
        return results;
      }

      const reportPath = resolve(tempDir, "jscpd-report.json");
      if (!existsSync(reportPath)) {
        return results;
      }

      output = readFileSync(reportPath, "utf-8");
    } else {
      output = cachedOutput;
    }

    const parsed = JSON.parse(output) as JscpdOutput;

    for (const dup of parsed.duplicates) {
      const firstPath = resolve(projectRoot, dup.firstFile.name);
      const firstInfo: DuplicationInfo = {
        startLine: dup.firstFile.startLoc.line,
        endLine: dup.firstFile.endLoc.line,
        startCol: dup.firstFile.startLoc.column,
        endCol: dup.firstFile.endLoc.column,
        lines: dup.lines,
        otherFile: dup.secondFile.name,
        otherStartLine: dup.secondFile.startLoc.line,
        otherEndLine: dup.secondFile.endLoc.line,
      };

      const firstExisting = results.get(firstPath);
      if (firstExisting) {
        firstExisting.push(firstInfo);
      } else {
        results.set(firstPath, [firstInfo]);
      }

      const secondPath = resolve(projectRoot, dup.secondFile.name);
      const secondInfo: DuplicationInfo = {
        startLine: dup.secondFile.startLoc.line,
        endLine: dup.secondFile.endLoc.line,
        startCol: dup.secondFile.startLoc.column,
        endCol: dup.secondFile.endLoc.column,
        lines: dup.lines,
        otherFile: dup.firstFile.name,
        otherStartLine: dup.firstFile.startLoc.line,
        otherEndLine: dup.firstFile.endLoc.line,
      };

      const secondExisting = results.get(secondPath);
      if (secondExisting) {
        secondExisting.push(secondInfo);
      } else {
        results.set(secondPath, [secondInfo]);
      }
    }
  } catch (error) {
    console.error(
      "[no-code-duplication] Error parsing jscpd output:",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  return results;
}
