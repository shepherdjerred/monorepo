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

export async function getMainStatus(
  github: GitHubClient,
  config: WoodpeckerConfig,
  signal?: AbortSignal,
): Promise<MainStatus> {
  const [branch, listed] = await Promise.all([
    github.read(
      `/repos/${github.repo}/branches/main`,
      z.object({ commit: z.object({ sha: z.string() }) }),
      signal,
    ),
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
    branch.commit.sha,
    listed,
    config,
    signal,
  );
  return {
    headSha: branch.commit.sha,
    latest,
    lastVerdict,
    state: mainVerdict(latest, lastVerdict),
    url: latest === null ? null : pipelineUrl(latest, config),
  };
}
