import { Context } from "@temporalio/activity";
import { Octokit, RequestError } from "octokit";
import * as Sentry from "@sentry/bun";
import { z } from "zod/v4";
import { withSpan } from "#observability/tracing.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import type {
  ClaudeMdFile,
  PrFileDiff,
  RetrievedSymbolForPrompt,
} from "#shared/pr-review/context.ts";
import { computeFileBlockDiff, type FileBlockDiff } from "#lib/block-diff.ts";
import { buildSymbolIndex, type SymbolIndex } from "#lib/symbol-index.ts";
import {
  formatRetrievedSymbols,
  hybridSearch,
  runToolkitRecallSearch,
  type RecallSearchFn,
} from "#lib/hybrid-retrieval.ts";
import {
  cleanupWorkdir as cleanupWorkdirImpl,
  defaultWorkdirDeps,
  provisionWorkdir,
  type WorkdirDeps,
  type WorkdirEnv,
} from "#lib/pr-review-workdir.ts";

/**
 * Narrowing schema for the `getContent` response when the path resolves to a
 * file. `content` is base64 (when `encoding === "base64"`) per the contents
 * API spec. Other variants of the union (directories, symlinks, submodules)
 * fail the parse and the CLAUDE.md walker treats them as missing.
 */
const ClaudeMdContentResponseSchema = z.object({
  type: z.literal("file"),
  encoding: z.literal("base64"),
  content: z.string(),
});

const COMPONENT = "pr-review-pipeline";

/**
 * Bootstrap output — the diff + CLAUDE.md hierarchy the specialist reviewers
 * read against. `workdir` will be populated in Phase 5+ when we start cloning
 * PR heads into ZFS scratch volumes; for now it's the empty string.
 *
 * Structurally identical to `PrReviewContext` (see
 * `packages/temporal/src/shared/pr-review/context.ts`); declared locally so
 * workflow code can refer to the type without taking a hard dependency on
 * this activity module's other exports.
 */
export type BootstrapResult = {
  workdir: string;
  changedFiles: PrFileDiff[];
  claudeMdHierarchy: ClaudeMdFile[];
  /**
   * Phase 5 retrieval output (related symbols + snippets). Empty until the
   * bootstrap rewrite clones the PR head into the workdir and invokes
   * `buildSymbolIndex` + `hybridSearch`; the activity / runner already
   * threads it through so we can light up retrieval without further plumbing
   * once the workdir lands.
   */
  retrievedSymbols: RetrievedSymbolForPrompt[];
  /**
   * Phase 6 AST-structured block diffs, one per changed file. Empty until
   * bootstrap fetches `newSource` for each file and invokes
   * `computeFileBlockDiff`; the runner already renders this section in the
   * specialist prompt so it lights up the moment bootstrap populates it.
   */
  blockDiffs: FileBlockDiff[];
};

const CLAUDE_MD_FILENAME = "CLAUDE.md";

function sendHeartbeat(note: string): void {
  Context.current().heartbeat({ phase: `bootstrap:${note}` });
}

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "bootstrapContext",
      ...fields,
    }),
  );
}

function captureWithContext(
  error: unknown,
  input: PrReviewPipelineInput,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    const info = Context.current().info;
    scope.setTag("workflow", info.workflowType);
    scope.setTag("activity", info.activityType);
    scope.setTag("component", COMPONENT);
    scope.setContext("prReviewBootstrap", {
      workflowId: info.workflowExecution.workflowId,
      runId: info.workflowExecution.runId,
      attempt: info.attempt,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      ...extra,
    });
    Sentry.captureException(error);
  });
}

/**
 * Minimal Octokit slice the bootstrap actually uses. Same widen-to-unknown
 * trick as `post.ts` for paginate routes the activity hands off as opaque
 * pointers.
 */
/**
 * `getContent` returns a discriminated union (file / dir / symlink / submodule)
 * — see https://docs.github.com/en/rest/repos/contents — so we keep `data`
 * loosely typed and inspect at runtime. `unknown` is the only widening allowed
 * by the no-type-assertions ESLint rule; downstream code narrows with
 * `typeof` + property checks.
 */
export type BootstrapOctokit = {
  paginate: {
    iterator: (
      route: unknown,
      params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
      },
    ) => AsyncIterable<{
      data: {
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string | null;
      }[];
    }>;
  };
  rest: {
    pulls: {
      listFiles: unknown;
    };
    repos: {
      getContent: (params: {
        owner: string;
        repo: string;
        path: string;
        ref: string;
      }) => Promise<{ data: unknown }>;
    };
  };
};

/**
 * Treat GitHub's `status` enum as a Zod-validated string union. Anything
 * unexpected (Octokit does occasionally surface non-spec values) folds to
 * `"changed"` so we don't drop the file.
 */
const PrFileStatusSchema = z.enum([
  "added",
  "removed",
  "modified",
  "renamed",
  "copied",
  "changed",
  "unchanged",
]);

function normalizeStatus(status: string): PrFileDiff["status"] {
  const parsed = PrFileStatusSchema.safeParse(status);
  return parsed.success ? parsed.data : "changed";
}

async function fetchChangedFiles(
  octokit: BootstrapOctokit,
  input: PrReviewPipelineInput,
): Promise<PrFileDiff[]> {
  const out: PrFileDiff[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listFiles, {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.prNumber,
    per_page: 100,
  });
  for await (const page of iterator) {
    for (const f of page.data) {
      out.push({
        path: f.filename,
        status: normalizeStatus(f.status),
        additions: f.additions,
        deletions: f.deletions,
        // octokit returns either a string or omits the field entirely for
        // binary / oversize files. Normalize to `null` so the downstream
        // schema (PrFileDiffSchema) parses cleanly.
        patch: typeof f.patch === "string" ? f.patch : null,
      });
    }
  }
  return out;
}

/**
 * Walk up from each changed file's directory toward the repo root, fetching
 * `CLAUDE.md` at every level via the contents API at the PR head SHA. De-dupe
 * by path so we never fetch the same file twice. Missing files (404) are
 * silently skipped — the CLAUDE.md hierarchy is sparse on purpose.
 */
async function fetchClaudeMdHierarchy(
  octokit: BootstrapOctokit,
  input: PrReviewPipelineInput,
  changedFiles: readonly PrFileDiff[],
): Promise<ClaudeMdFile[]> {
  const candidatePaths = new Set<string>();
  candidatePaths.add(CLAUDE_MD_FILENAME);
  for (const f of changedFiles) {
    let dir = f.path;
    for (;;) {
      const slash = dir.lastIndexOf("/");
      if (slash === -1) {
        break;
      }
      dir = dir.slice(0, slash);
      if (dir.length === 0) {
        break;
      }
      candidatePaths.add(`${dir}/${CLAUDE_MD_FILENAME}`);
    }
  }

  const found: ClaudeMdFile[] = [];
  for (const path of candidatePaths) {
    try {
      const resp = await octokit.rest.repos.getContent({
        owner: input.owner,
        repo: input.repo,
        path,
        ref: input.commitSha,
      });
      // `resp.data` is `unknown` from the BootstrapOctokit shape (the real
      // Octokit return is a discriminated union of file/dir/symlink/submodule).
      // safeParse against the file variant: dirs / symlinks / submodules fail
      // the parse and we treat them as "no CLAUDE.md at this level".
      const parsed = ClaudeMdContentResponseSchema.safeParse(resp.data);
      if (parsed.success) {
        const decoded = Buffer.from(parsed.data.content, "base64").toString(
          "utf8",
        );
        found.push({ path, content: decoded });
      }
    } catch (error: unknown) {
      // 404 (file not present at this level of the hierarchy) is the
      // expected case — keep walking. Other errors are real and need to
      // surface so we don't ship a review against incomplete context.
      if (error instanceof RequestError && error.status === 404) {
        continue;
      }
      throw error;
    }
  }

  // Sort root → deepest so the prompt cache breakpoints stay deterministic
  // across PRs (the prefix render order matters — see
  // `shared/prompt-caching.md` in the claude-api skill).
  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
}

/**
 * Pure runner — exported so the replay CLI can drive bootstrap directly with
 * a real Octokit and no Temporal context.
 */
export async function runBootstrap(
  octokit: BootstrapOctokit,
  input: PrReviewPipelineInput,
  heartbeat: (note: string) => void,
): Promise<BootstrapResult> {
  heartbeat("listing-files");
  const changedFiles = await fetchChangedFiles(octokit, input);
  heartbeat("walking-claude-md-hierarchy");
  const claudeMdHierarchy = await fetchClaudeMdHierarchy(
    octokit,
    input,
    changedFiles,
  );
  return {
    workdir: "",
    changedFiles,
    claudeMdHierarchy,
    retrievedSymbols: [],
    blockDiffs: [],
  };
}

/**
 * Dependencies for the workdir-enrichment pass. Production uses the
 * defaults; tests stub them.
 */
export type EnrichDeps = {
  /** Workdir provisioning (mkdir, rmrf, git clone, file reads). */
  workdir: WorkdirDeps;
  /** Recall subprocess for the semantic retrieval pass; `null` skips it. */
  recallSearch: RecallSearchFn | null;
};

export type EnrichBootstrapInput = {
  base: BootstrapResult;
  pipeline: PrReviewPipelineInput;
  workflowId: string;
  env: WorkdirEnv;
  deps: EnrichDeps;
  heartbeat: (note: string) => void;
  /** Maximum number of retrieved symbols to surface in the prompt. */
  retrievalTopK?: number;
};

/**
 * Stitch together the concatenated patch text from every changed file
 * with a non-null patch. Used as the "diff" query for hybrid retrieval —
 * identifiers come from added/removed lines, so adding `+`/`-` headers
 * matters less than concatenation order.
 */
function concatenatePatchesForRetrieval(files: readonly PrFileDiff[]): string {
  const lines: string[] = [];
  for (const f of files) {
    if (f.patch === null) continue;
    lines.push(`--- a/${f.path}`);
    lines.push(`+++ b/${f.path}`);
    lines.push(f.patch);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Compute per-file block diffs for every changed file with a patch and
 * a readable workdir copy. Files that are deleted from the head (no
 * readable copy) and binary files (patch is null) are silently skipped.
 */
async function computeBlockDiffsForFiles(
  workdir: string,
  files: readonly PrFileDiff[],
  workdirDeps: WorkdirDeps,
): Promise<FileBlockDiff[]> {
  const out: FileBlockDiff[] = [];
  for (const f of files) {
    if (f.patch === null) continue;
    if (f.status === "removed") continue;
    const newSource = await workdirDeps.readFileUtf8(`${workdir}/${f.path}`);
    if (newSource === null) continue;
    const diff = await computeFileBlockDiff({
      filePath: f.path,
      newSource,
      patch: f.patch,
    });
    out.push(diff);
  }
  return out;
}

/**
 * Map a `RetrievedSymbol` (with debug `sources`) into the prompt-facing
 * `RetrievedSymbolForPrompt` shape (entry + score + snippet). Reads the
 * surrounding source for each entry directly from the workdir.
 */
type BuildPromptSymbolsParams = {
  workdir: string;
  index: SymbolIndex;
  diff: string;
  recallSearch: RecallSearchFn | null;
  topK: number;
};

async function buildPromptSymbolsForIndex(
  params: BuildPromptSymbolsParams,
): Promise<RetrievedSymbolForPrompt[]> {
  const { workdir, index, diff, recallSearch, topK } = params;
  const retrieved = await hybridSearch({
    diff,
    index,
    repoRoot: workdir,
    k: topK,
    recallSearch,
  });
  // `formatRetrievedSymbols` returns one Markdown string; we need per-entry
  // snippet strings so we can render each in its own section. Compute the
  // formatted block by calling formatRetrievedSymbols with a single-element
  // array per result — keeps the snippet logic in one place.
  const out: RetrievedSymbolForPrompt[] = [];
  for (const r of retrieved) {
    const formatted = await formatRetrievedSymbols([r], { repoRoot: workdir });
    // Strip the leading "## <name> ..." line so the runner.ts header doesn't
    // double up. formatRetrievedSymbols's block is "## name (kind) — file:line\n```\n<snippet>\n```".
    const fenceStart = formatted.indexOf("```");
    const fenceEnd = formatted.lastIndexOf("```");
    const snippet =
      fenceStart !== -1 && fenceEnd > fenceStart
        ? formatted.slice(fenceStart + 3, fenceEnd).trim()
        : "";
    out.push({ entry: r.entry, score: r.score, snippet });
  }
  return out;
}

/**
 * Provision a workdir, clone the PR head, then populate
 * `retrievedSymbols` + `blockDiffs` against it. Throws on clone failure
 * or missing `git` — we deliberately do NOT silently fall back to empty
 * arrays.
 *
 * Caller is responsible for invoking `cleanupWorkdir(result.workdir)` on
 * workflow completion. We don't auto-clean here because failure-path
 * inspection (e.g. shadow-mode diff dumps) depends on the workdir still
 * being present.
 */
export async function enrichBootstrapWithWorkdir(
  input: EnrichBootstrapInput,
): Promise<BootstrapResult> {
  const { base, pipeline, workflowId, env, deps, heartbeat } = input;
  const topK = input.retrievalTopK ?? 1;

  heartbeat("provisioning-workdir");
  const workdir = await provisionWorkdir({
    workflowId,
    owner: pipeline.owner,
    repo: pipeline.repo,
    ref: pipeline.commitSha,
    env,
    deps: deps.workdir,
  });

  heartbeat("building-symbol-index");
  const index = await buildSymbolIndex({
    repoRoot: workdir,
    commitSha: pipeline.commitSha,
  });

  heartbeat("running-hybrid-retrieval");
  const diff = concatenatePatchesForRetrieval(base.changedFiles);
  const retrievedSymbols =
    diff.length === 0
      ? []
      : await buildPromptSymbolsForIndex({
          workdir,
          index,
          diff,
          recallSearch: deps.recallSearch,
          topK,
        });

  heartbeat("computing-block-diffs");
  const blockDiffs = await computeBlockDiffsForFiles(
    workdir,
    base.changedFiles,
    deps.workdir,
  );

  return {
    workdir,
    changedFiles: base.changedFiles,
    claudeMdHierarchy: base.claudeMdHierarchy,
    retrievedSymbols,
    blockDiffs,
  };
}

/**
 * Public wrapper so callers (workflows, replay CLI) can tear down a
 * workdir without reaching into `#lib/`. Thin pass-through over the lib
 * function — kept here so bootstrap.ts is the single import surface for
 * workdir lifecycle operations.
 */
export async function cleanupWorkdir(workdir: string): Promise<void> {
  await cleanupWorkdirImpl(workdir);
}

async function bootstrapContextImpl(
  input: PrReviewPipelineInput,
): Promise<BootstrapResult> {
  return await withSpan(
    "prReview.bootstrapContext",
    {
      "pr.owner": input.owner,
      "pr.repo": input.repo,
      "pr.number": input.prNumber,
      "pr.commitSha": input.commitSha,
    },
    async () => {
      const token = Bun.env["GH_TOKEN"];
      if (token === undefined || token === "") {
        throw new Error("GH_TOKEN is required for pr-review bootstrap");
      }
      const octokit = new Octokit({ auth: token });

      try {
        const base = await runBootstrap(octokit, input, sendHeartbeat);
        const workflowId = Context.current().info.workflowExecution.workflowId;
        const enriched = await enrichBootstrapWithWorkdir({
          base,
          pipeline: input,
          workflowId,
          env: { GH_TOKEN: token },
          deps: {
            workdir: defaultWorkdirDeps,
            recallSearch: runToolkitRecallSearch,
          },
          heartbeat: sendHeartbeat,
        });
        jsonLog("info", "bootstrapContext fetched diff + CLAUDE.md hierarchy", {
          prNumber: input.prNumber,
          commitSha: input.commitSha,
          changedFilesCount: enriched.changedFiles.length,
          claudeMdCount: enriched.claudeMdHierarchy.length,
          workdir: enriched.workdir,
          retrievedSymbolCount: enriched.retrievedSymbols.length,
          blockDiffCount: enriched.blockDiffs.length,
        });
        return enriched;
      } catch (error: unknown) {
        captureWithContext(error, input);
        jsonLog("error", "bootstrapContext failed", {
          prNumber: input.prNumber,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  );
}

export type BootstrapActivities = typeof bootstrapActivities;

export const bootstrapActivities = {
  async prReviewBootstrap(
    input: PrReviewPipelineInput,
  ): Promise<BootstrapResult> {
    return bootstrapContextImpl(input);
  },
};
