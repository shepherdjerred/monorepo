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
import { resolve } from "node:path";

const KNIP_CACHE_FILE = ".knip-cache.json";
const JSCPD_CACHE_FILE = ".jscpd-cache.json";

type KnipExportEntry = {
  name: string;
  line: number;
  col: number;
  pos: number;
};

type KnipIssue = {
  file: string;
  dependencies: unknown[];
  devDependencies: unknown[];
  optionalPeerDependencies: unknown[];
  unresolved: unknown[];
  exports: KnipExportEntry[];
  catalog: unknown[];
};

type KnipOutput = {
  files: string[];
  issues: KnipIssue[];
};

export type KnipFileResult = {
  isUnusedFile: boolean;
  unusedExports: Array<{
    symbol: string;
    line?: number;
    col?: number;
  }>;
};

export type KnipResults = Map<string, KnipFileResult>;

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
  const results: KnipResults = new Map();

  try {
    let output = readKnipCache(projectRoot);

    if (output === null) {
      const result = spawnSync("bunx", ["knip", "--reporter", "json"], {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 120_000,
        shell: false,
      });

      if (result.error) {
        console.error(
          "[knip-unused] Failed to run knip:",
          result.error.message,
        );
        return results;
      }

      output = result.stdout.trim();
    }

    if (!output) {
      return results;
    }

    const parsed = JSON.parse(output) as KnipOutput;

    for (const file of parsed.files) {
      const absPath = resolve(projectRoot, file);
      results.set(absPath, {
        isUnusedFile: true,
        unusedExports: [],
      });
    }

    for (const issue of parsed.issues) {
      const absPath = resolve(projectRoot, issue.file);
      const existing = results.get(absPath);

      const unusedExports = issue.exports.map((exp) => ({
        symbol: exp.name,
        line: exp.line,
        col: exp.col,
      }));

      if (existing) {
        existing.unusedExports.push(...unusedExports);
      } else {
        results.set(absPath, {
          isUnusedFile: false,
          unusedExports,
        });
      }
    }
  } catch (error) {
    console.error(
      "[knip-unused] Error parsing knip output:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return results;
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

    if (cachedOutput !== null) {
      output = cachedOutput;
    } else {
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
