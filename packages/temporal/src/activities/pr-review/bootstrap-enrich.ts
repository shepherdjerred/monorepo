import type { FileBlockDiff } from "#lib/block-diff.ts";
import { computeFileBlockDiff } from "#lib/block-diff.ts";
import { buildSymbolIndex, type SymbolIndex } from "#lib/symbol-index.ts";
import {
  formatRetrievedSymbols,
  retrieveSymbols,
} from "#lib/symbol-retrieval.ts";
import {
  provisionWorkdir,
  type WorkdirDeps,
  type WorkdirEnv,
} from "#lib/pr-review-workdir.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import type {
  PrFileDiff,
  RetrievedSymbolForPrompt,
} from "#shared/pr-review/context.ts";
import type { BootstrapResult } from "./bootstrap.ts";

export type EnrichDeps = {
  workdir: WorkdirDeps;
};

export type EnrichBootstrapInput = {
  base: BootstrapResult;
  pipeline: PrReviewPipelineInput;
  workflowId: string;
  env: WorkdirEnv;
  deps: EnrichDeps;
  heartbeat: (note: string) => void;
  retrievalTopK?: number;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: "pr-review-pipeline",
      activity: "bootstrapContext",
      ...fields,
    }),
  );
}

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
    try {
      const diff = await computeFileBlockDiff({
        filePath: f.path,
        newSource,
        patch: f.patch,
      });
      out.push(diff);
    } catch (error: unknown) {
      jsonLog("warning", "block-diff parse failed; using line fallback", {
        file: f.path,
        error: error instanceof Error ? error.message : String(error),
      });
      out.push({
        file: f.path,
        language: null,
        blocks: [],
        orphanHunks: [],
        lineFallback: f.patch,
      });
    }
  }
  return out;
}

type BuildPromptSymbolsParams = {
  workdir: string;
  index: SymbolIndex;
  diff: string;
  topK: number;
};

async function buildPromptSymbolsForIndex(
  params: BuildPromptSymbolsParams,
): Promise<RetrievedSymbolForPrompt[]> {
  const { workdir, index, diff, topK } = params;
  const retrieved = retrieveSymbols({
    diff,
    index,
    k: topK,
  });
  const out: RetrievedSymbolForPrompt[] = [];
  for (const r of retrieved) {
    const formatted = await formatRetrievedSymbols([r], { repoRoot: workdir });
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

  heartbeat("running-symbol-retrieval");
  const diff = concatenatePatchesForRetrieval(base.changedFiles);
  const retrievedSymbols =
    diff.length === 0
      ? []
      : await buildPromptSymbolsForIndex({
          workdir,
          index,
          diff,
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
    skipReviewReason: base.skipReviewReason,
  };
}
