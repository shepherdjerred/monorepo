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
import type { FileBlockDiff } from "#lib/block-diff.ts";

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
        const result = await runBootstrap(octokit, input, sendHeartbeat);
        jsonLog("info", "bootstrapContext fetched diff + CLAUDE.md hierarchy", {
          prNumber: input.prNumber,
          commitSha: input.commitSha,
          changedFilesCount: result.changedFiles.length,
          claudeMdCount: result.claudeMdHierarchy.length,
        });
        return result;
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
