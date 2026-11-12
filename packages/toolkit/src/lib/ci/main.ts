import { z } from "zod";
import {
  getPipeline,
  listPipelines,
  pipelineUrl,
  type WoodpeckerConfig,
  type WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";
import type { GitHubClient } from "./github.ts";
import { isFailure, workflowStatus } from "./status.ts";

export type MainStatus = {
  headSha: string;
  latest: WoodpeckerPipeline | null;
  lastVerdict: WoodpeckerPipeline | null;
  state: "green" | "red" | "pending";
  url: string | null;
};

function completedVerdict(
  pipeline: Pick<WoodpeckerPipeline, "finished" | "status">,
): boolean {
  return (
    (pipeline.finished ?? 0) > 0 &&
    workflowStatus(pipeline.status) !== "PENDING"
  );
}

function failedWorkflows(pipeline: WoodpeckerPipeline): boolean {
  for (const workflow of pipeline.workflows) workflowStatus(workflow.state);
  return pipeline.workflows.some((workflow) => isFailure(workflow.state));
}

// Manual main runs can recover a missing push webhook, but a targeted manual
// job must not clear a failed main verdict. Require the verification and
// release graph, including admission and artifact publication, without skips.
function verifiesMain(pipeline: WoodpeckerPipeline): boolean {
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

export function mainVerdict(
  latest: WoodpeckerPipeline | null,
  lastVerdict: WoodpeckerPipeline | null,
): MainStatus["state"] {
  if (latest !== null) {
    const status = workflowStatus(latest.status);
    if (status === "UNHEALTHY" || failedWorkflows(latest)) return "red";
    if (status === "HEALTHY") return "green";
  }
  return lastVerdict !== null &&
    workflowStatus(lastVerdict.status) === "UNHEALTHY"
    ? "red"
    : "pending";
}

function assertMainIdentity(
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

async function selectMainRuns(
  headSha: string,
  listed: Awaited<ReturnType<typeof listPipelines>>,
  config: WoodpeckerConfig,
  signal?: AbortSignal,
): Promise<Pick<MainStatus, "latest" | "lastVerdict">> {
  let latest: WoodpeckerPipeline | null = null;
  let lastVerdict: WoodpeckerPipeline | null = null;
  for (const entry of listed) {
    const needsCurrent = latest === null && entry.commit === headSha;
    const needsVerdict = lastVerdict === null && completedVerdict(entry);
    if (!needsCurrent && !needsVerdict) continue;
    const pipeline = await getPipeline(entry.number, config, signal);
    assertMainIdentity(pipeline, entry);
    if (!verifiesMain(pipeline)) continue;
    if (needsCurrent) latest = pipeline;
    if (lastVerdict === null && completedVerdict(pipeline))
      lastVerdict = pipeline;
  }
  return { latest, lastVerdict };
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

/** Throws unless `sha` is main's tip or one of its ancestors. */
export async function assertOnMain(
  github: GitHubClient,
  sha: string,
  signal?: AbortSignal,
): Promise<void> {
  const comparison = await github.read(
    `/repos/${github.repo}/compare/${sha}...main`,
    z.object({
      status: z.enum(["ahead", "behind", "identical", "diverged"]),
    }),
    signal,
  );
  if (comparison.status !== "ahead" && comparison.status !== "identical")
    throw new Error(`${sha} is not on main (main is ${comparison.status})`);
}

export async function getMainStatus(
  github: GitHubClient,
  config: WoodpeckerConfig,
  signal?: AbortSignal,
  maxAgeMs = 0,
): Promise<MainStatus> {
  const [tip, listed] = await Promise.all([
    readMainTip(github, signal, maxAgeMs),
    listPipelines(
      config,
      {
        event: ["push", "manual"],
        branch: "main",
        // A completed manual run may be partial. Read through it until a
        // completed push gives us a lower bound for the last main verdict.
        stopWhen: (entries) =>
          entries.some(
            (entry) => entry.event === "push" && completedVerdict(entry),
          ),
      },
      signal,
    ),
  ]);
  const { latest, lastVerdict } = await selectMainRuns(
    tip,
    listed,
    config,
    signal,
  );
  return {
    headSha: tip,
    latest,
    lastVerdict,
    state: mainVerdict(latest, lastVerdict),
    url: latest === null ? null : pipelineUrl(latest, config),
  };
}

/** Main runs searched for a pinned commit before reporting none exists yet. */
const PINNED_RUN_WINDOW = 200;

export type MainRunSnapshot = {
  /** The pinned main commit this wait reports on. */
  sha: string;
  /** Main's tip when this snapshot was read. */
  tipSha: string;
  /** The newest run that verifies the pinned commit, if one exists. */
  run: WoodpeckerPipeline | null;
  url: string | null;
};

/** The newest verifying main run for one exact commit. */
export async function getMainRun(
  github: GitHubClient,
  config: WoodpeckerConfig,
  sha: string,
  signal?: AbortSignal,
): Promise<MainRunSnapshot> {
  const [tip, listed] = await Promise.all([
    readMainTip(github, signal),
    listPipelines(
      config,
      {
        event: ["push", "manual"],
        branch: "main",
        // Runs are listed newest first, and a commit's push run precedes any
        // manual recovery of it. Once its push is listed, every newer run of
        // that commit is too; a partial manual run must not stop the search.
        stopWhen: (entries) =>
          entries.length >= PINNED_RUN_WINDOW ||
          entries.some(
            (entry) => entry.commit === sha && entry.event === "push",
          ),
      },
      signal,
    ),
  ]);
  let run: WoodpeckerPipeline | null = null;
  for (const entry of listed) {
    if (entry.commit !== sha) continue;
    const pipeline = await getPipeline(entry.number, config, signal);
    assertMainIdentity(pipeline, entry);
    if (!verifiesMain(pipeline)) continue;
    run = pipeline;
    break;
  }
  return {
    sha,
    tipSha: tip,
    run,
    url: run === null ? null : pipelineUrl(run, config),
  };
}
