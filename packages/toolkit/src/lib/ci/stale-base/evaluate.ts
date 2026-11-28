import path from "node:path";
import { z } from "zod";
import type { GitHubClient } from "#lib/ci/github.ts";
import {
  directWorkspaces,
  isGlobalRootInput,
  loadWorkspaceGraph,
  reverseClosureForPaths,
  SYNTHESIS_WORKSPACES,
  touchesSynthesisGroup,
  type WorkspaceGraph,
} from "./workspaces.ts";

export const StaleBaseVerdictSchema = z.enum([
  "up_to_date",
  "disjoint_clean",
  "stale_overlap",
]);
export type StaleBaseVerdict = z.infer<typeof StaleBaseVerdictSchema>;

export const StaleBaseReportSchema = z.object({
  stale: z.boolean(),
  headSha: z.string(),
  mergeBaseSha: z.string(),
  mainHeadSha: z.string(),
  behindBy: z.number().int().nonnegative(),
  verdict: StaleBaseVerdictSchema,
  reasons: z.array(z.string()),
});
export type StaleBaseReport = z.infer<typeof StaleBaseReportSchema>;

export const DiffFileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  previous_filename: z.string().optional(),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const CompareResponseSchema = z.object({
  status: z.enum(["diverged", "ahead", "behind", "identical"]),
  ahead_by: z.number().int().nonnegative(),
  behind_by: z.number().int().nonnegative(),
  total_commits: z.number().int().nonnegative(),
  base_commit: z.object({ sha: z.string() }),
  merge_base_commit: z.object({ sha: z.string() }),
  commits: z.array(z.object({ sha: z.string() })),
  files: z.array(DiffFileSchema).default([]),
});
export type CompareResponse = z.infer<typeof CompareResponseSchema>;

export const REST_FILES_TRUNCATION_LIMIT = 300;
export const COMPARE_COMMITS_TRUNCATION_LIMIT = 250;

function diffPaths(files: readonly DiffFile[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    paths.add(file.filename);
    if (file.previous_filename !== undefined && file.previous_filename !== "") {
      paths.add(file.previous_filename);
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

function parentDirectory(filePath: string): string {
  const dir = path.posix.dirname(filePath);
  return dir === "" ? "." : dir;
}

function addedDirectories(files: readonly DiffFile[]): Set<string> {
  const dirs = new Set<string>();
  for (const file of files) {
    if (file.filename.split("/").includes("generated")) {
      continue;
    }
    const targetDir = parentDirectory(file.filename);
    if (file.status === "added") {
      dirs.add(targetDir);
    } else if (
      file.status === "renamed" &&
      (file.previous_filename === undefined ||
        parentDirectory(file.previous_filename) !== targetDir)
    ) {
      dirs.add(targetDir);
    }
  }
  return dirs;
}

function intersectSorted(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): string[] {
  const shared: string[] = [];
  for (const item of left) {
    if (right.has(item)) {
      shared.push(item);
    }
  }
  return shared.sort((a, b) => a.localeCompare(b));
}

function summarizeList(items: readonly string[], limit = 4): string {
  return items.length <= limit
    ? items.join(", ")
    : `${items.slice(0, limit).join(", ")} (+${String(items.length - limit)} more)`;
}

function truncationReasons(input: {
  readonly prFilesCount: number;
  readonly mainFilesCount: number;
  readonly totalCommits: number;
}): string[] {
  const reasons: string[] = [];
  if (input.prFilesCount >= REST_FILES_TRUNCATION_LIMIT) {
    reasons.push(
      `PR diff reached ${String(input.prFilesCount)} files (GitHub API 300-file truncation limit; failing closed)`,
    );
  }
  if (input.mainFilesCount >= REST_FILES_TRUNCATION_LIMIT) {
    reasons.push(
      `main advance diff reached ${String(input.mainFilesCount)} files (GitHub API 300-file truncation limit; failing closed)`,
    );
  }
  if (input.totalCommits > COMPARE_COMMITS_TRUNCATION_LIMIT) {
    reasons.push(
      `main advanced by ${String(input.totalCommits)} commits (> 250 compare commit limit; failing closed)`,
    );
  }
  return reasons;
}

export type OverlapEvaluationInput = {
  readonly headSha: string;
  readonly mergeBaseSha: string;
  readonly mainHeadSha: string;
  readonly behindBy: number;
  readonly compareStatus?: CompareResponse["status"] | undefined;
  readonly totalCommits?: number | undefined;
  readonly prFiles: readonly DiffFile[];
  readonly mainFiles: readonly DiffFile[];
  readonly graph: WorkspaceGraph;
};

export function computeStaleBaseOverlap(
  input: OverlapEvaluationInput,
): StaleBaseReport {
  if (input.compareStatus === "identical" || input.behindBy === 0) {
    return {
      stale: false,
      headSha: input.headSha,
      mergeBaseSha: input.mergeBaseSha,
      mainHeadSha: input.mainHeadSha,
      behindBy: 0,
      verdict: "up_to_date",
      reasons: [],
    };
  }

  const reasons = truncationReasons({
    prFilesCount: input.prFiles.length,
    mainFilesCount: input.mainFiles.length,
    totalCommits: input.totalCommits ?? input.behindBy,
  });

  const prPaths = diffPaths(input.prFiles);
  const mainPaths = diffPaths(input.mainFiles);

  const globalInputs = mainPaths.filter((filePath) =>
    isGlobalRootInput(filePath),
  );
  if (globalInputs.length > 0) {
    reasons.push(
      `main modified global verification input(s): ${summarizeList(globalInputs)}`,
    );
  }

  const prDirect = directWorkspaces(prPaths, input.graph);
  const mainDirect = directWorkspaces(mainPaths, input.graph);
  const prReverse = reverseClosureForPaths(prPaths, input.graph);
  const mainReverse = reverseClosureForPaths(mainPaths, input.graph);

  const prHitByMain = intersectSorted(prDirect, mainReverse);
  const mainHitByPr = intersectSorted(mainDirect, prReverse);
  const overlapWorkspaces = [...new Set([...prHitByMain, ...mainHitByPr])].sort(
    (a, b) => a.localeCompare(b),
  );
  if (overlapWorkspaces.length > 0) {
    reasons.push(
      `workspace dependency overlap with main advances: ${summarizeList(overlapWorkspaces)}`,
    );
  }

  if (
    touchesSynthesisGroup(prPaths, prDirect) &&
    touchesSynthesisGroup(mainPaths, mainDirect)
  ) {
    const prSynth = [...prDirect].filter((pkg) =>
      SYNTHESIS_WORKSPACES.has(pkg),
    );
    const mainSynth = [...mainDirect].filter((pkg) =>
      SYNTHESIS_WORKSPACES.has(pkg),
    );
    const label = summarizeList(
      [...new Set([...prSynth, ...mainSynth])].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
    reasons.push(
      `both PR and main touched shared homelab/catalog synthesis inputs${label === "" ? "" : ` (${label})`}`,
    );
  }

  const sameAddedDirs = intersectSorted(
    addedDirectories(input.prFiles),
    addedDirectories(input.mainFiles),
  );
  if (sameAddedDirs.length > 0) {
    reasons.push(
      `both PR and main added files in directory ${summarizeList(sameAddedDirs)} (check-directory-file-counts cap)`,
    );
  }

  const stale = reasons.length > 0;
  return {
    stale,
    headSha: input.headSha,
    mergeBaseSha: input.mergeBaseSha,
    mainHeadSha: input.mainHeadSha,
    behindBy: input.behindBy,
    verdict: stale ? "stale_overlap" : "disjoint_clean",
    reasons,
  };
}

async function fetchPrFilesBounded(
  github: GitHubClient,
  prNumber: number,
  signal?: AbortSignal,
): Promise<DiffFile[]> {
  const files: DiffFile[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await github.read(
      `/repos/${github.repo}/pulls/${String(prNumber)}/files?per_page=100&page=${String(page)}`,
      z.array(DiffFileSchema),
      signal,
    );
    files.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return files;
}

export type EvaluateStaleBaseOptions = {
  readonly github: GitHubClient;
  readonly prNumber: number;
  readonly headSha: string;
  readonly baseRef?: string | undefined;
  readonly mainHeadSha?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly graph?: WorkspaceGraph | undefined;
  readonly signal?: AbortSignal | undefined;
};

export async function evaluateStaleBase(
  options: EvaluateStaleBaseOptions,
): Promise<StaleBaseReport> {
  const baseRef = options.baseRef ?? "main";
  const compare = await options.github.read(
    `/repos/${options.github.repo}/compare/${encodeURIComponent(options.headSha)}...${encodeURIComponent(baseRef)}`,
    CompareResponseSchema,
    options.signal,
  );
  const mainHeadSha =
    options.mainHeadSha ??
    compare.commits.at(-1)?.sha ??
    compare.merge_base_commit.sha;

  if (compare.status === "identical" || compare.ahead_by === 0) {
    return {
      stale: false,
      headSha: options.headSha,
      mergeBaseSha: compare.merge_base_commit.sha,
      mainHeadSha,
      behindBy: 0,
      verdict: "up_to_date",
      reasons: [],
    };
  }

  const [prFiles, graph] = await Promise.all([
    fetchPrFilesBounded(options.github, options.prNumber, options.signal),
    options.graph === undefined
      ? loadWorkspaceGraph(options.repoRoot)
      : Promise.resolve(options.graph),
  ]);

  return computeStaleBaseOverlap({
    headSha: options.headSha,
    mergeBaseSha: compare.merge_base_commit.sha,
    mainHeadSha,
    behindBy: compare.ahead_by,
    compareStatus: compare.status,
    totalCommits: compare.total_commits,
    prFiles,
    mainFiles: compare.files,
    graph,
  });
}

export function formatStaleBaseLine(report: StaleBaseReport): string {
  const shortBase = report.mergeBaseSha.slice(0, 12);
  const shortMain = report.mainHeadSha.slice(0, 12);
  switch (report.verdict) {
    case "up_to_date":
      return `Up to date with main (${shortBase})`;
    case "disjoint_clean":
      return `Behind main by ${String(report.behindBy)} commit(s) (${shortBase}..${shortMain}) — disjoint from main advances`;
    case "stale_overlap":
      return `Behind main by ${String(report.behindBy)} commit(s) (${shortBase}..${shortMain}) — stale overlap (${report.reasons.join("; ")}); enforced at merge time`;
  }
}
