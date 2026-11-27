import { z } from "zod";
import {
  getPipeline,
  listPipelines,
  type WoodpeckerConfig,
  type WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";
import type { GitHubClient } from "#lib/ci/github.ts";
import { isFailure, workflowStatus } from "#lib/ci/status.ts";

/** Main runs searched for a pinned commit before reporting none exists yet. */
const PINNED_RUN_WINDOW = 200;

export type MainPipelineList = Awaited<ReturnType<typeof listPipelines>>;
export type MainPipelineEntry = MainPipelineList[number];

export type MainRunSnapshot = {
  /** The pinned main commit this wait reports on. */
  sha: string;
  /** Main's tip when this snapshot was read. */
  tipSha: string;
  /** The newest run that verifies the pinned commit, if one exists. */
  run: WoodpeckerPipeline | null;
  url: string | null;
};

export type CommitCompareStatus = "ahead" | "behind" | "identical" | "diverged";

const CompareStatusSchema = z.object({
  status: z.enum(["ahead", "behind", "identical", "diverged"]),
});

export function completedVerdict(
  pipeline: Pick<WoodpeckerPipeline, "finished" | "status">,
): boolean {
  return (
    (pipeline.finished ?? 0) > 0 &&
    workflowStatus(pipeline.status) !== "PENDING"
  );
}

export function isCanceledStatus(state: string): boolean {
  const normalized = state.toLowerCase();
  return normalized === "canceled" || normalized === "killed";
}

export function failedWorkflows(pipeline: WoodpeckerPipeline): boolean {
  for (const workflow of pipeline.workflows) workflowStatus(workflow.state);
  return pipeline.workflows.some((workflow) => isFailure(workflow.state));
}

// Manual main runs can recover a missing push webhook, but a targeted manual
// job must not clear a failed main verdict. Require the verification and
// release graph, including admission and artifact publication, without skips.
export function verifiesMain(pipeline: WoodpeckerPipeline): boolean {
  for (const workflow of pipeline.workflows) workflowStatus(workflow.state);
  if (pipeline.event === "push") return true;
  if (
    workflowStatus(pipeline.status) === "HEALTHY" &&
    pipeline.workflows.some(
      (workflow) => workflowStatus(workflow.state) !== "HEALTHY",
    )
  )
    return false;
  return [
    "verify",
    "homelab-release-admission",
    "images",
    "helm-push",
    "argocd-sync",
  ].every((name) => {
    const workflow = pipeline.workflows.find((item) => item.name === name);
    return workflow !== undefined && workflow.state.toLowerCase() !== "skipped";
  });
}

export function assertMainIdentity(
  pipeline: WoodpeckerPipeline,
  listed: Pick<WoodpeckerPipeline, "number" | "commit" | "event">,
): void {
  if (
    pipeline.number !== listed.number ||
    pipeline.commit !== listed.commit ||
    pipeline.event !== listed.event ||
    pipeline.ref !== "refs/heads/main" ||
    pipeline.branch !== "main"
  )
    throw new Error("Main pipeline does not match its listed main run");
}

export type PipelineLoader = {
  load: (entry: MainPipelineEntry) => Promise<WoodpeckerPipeline>;
  hasNewerVerifyingRun: (number: number) => Promise<boolean>;
};

export function createPipelineLoader(
  listed: MainPipelineList,
  config: WoodpeckerConfig,
  signal?: AbortSignal,
): PipelineLoader {
  const cache = new Map<number, Promise<WoodpeckerPipeline>>();
  const load = (entry: MainPipelineEntry): Promise<WoodpeckerPipeline> => {
    let cached = cache.get(entry.number);
    if (cached === undefined) {
      cached = (async () => {
        const pipeline = await getPipeline(entry.number, config, signal);
        assertMainIdentity(pipeline, entry);
        return pipeline;
      })();
      cache.set(entry.number, cached);
    }
    return cached;
  };
  const hasNewerVerifyingRun = async (number: number): Promise<boolean> => {
    const newer = listed.filter((candidate) => candidate.number > number);
    // Check push runs first since every push run on main verifies main.
    const ordered = [
      ...newer.filter((candidate) => candidate.event === "push"),
      ...newer.filter((candidate) => candidate.event !== "push"),
    ];
    for (const candidate of ordered) {
      const pipeline = await load(candidate);
      if (verifiesMain(pipeline)) return true;
    }
    return false;
  };
  return { load, hasNewerVerifyingRun };
}

export async function isSupersededCanceled(
  status: string,
  number: number,
  hasNewerVerifyingRun: (pipelineNumber: number) => Promise<boolean>,
): Promise<boolean> {
  return isCanceledStatus(status) && (await hasNewerVerifyingRun(number));
}

/** Main's current tip commit; `maxAgeMs` accepts a shared read that recent. */
export async function readMainTip(
  github: GitHubClient,
  signal?: AbortSignal,
  maxAgeMs = 0,
): Promise<string> {
  const branch = await github.read(
    `/repos/${github.repo}/branches/main`,
    z.object({ commit: z.object({ sha: z.string() }) }),
    signal,
    maxAgeMs,
  );
  return branch.commit.sha;
}

export async function compareCommits(
  github: GitHubClient,
  baseRef: string,
  headRef: string,
  signal?: AbortSignal,
): Promise<CommitCompareStatus> {
  const comparison = await github.read(
    `/repos/${github.repo}/compare/${baseRef}...${headRef}`,
    CompareStatusSchema,
    signal,
  );
  return comparison.status;
}

export async function readMainWindowThroughCommit(
  github: GitHubClient,
  config: WoodpeckerConfig,
  commitSha: string,
  signal?: AbortSignal,
): Promise<{ tip: string; listed: MainPipelineList }> {
  // Runs are listed newest first, and a commit's push run precedes any
  // manual recovery of it. Once its push is listed, every newer run of
  // that commit is too; a partial manual run must not stop the search.
  const [tip, listed] = await Promise.all([
    readMainTip(github, signal),
    listPipelines(
      config,
      {
        event: ["push", "manual"],
        branch: "main",
        stopWhen: (entries) =>
          entries.length >= PINNED_RUN_WINDOW ||
          entries.some(
            (entry) => entry.commit === commitSha && entry.event === "push",
          ),
      },
      signal,
    ),
  ]);
  return { tip, listed };
}
