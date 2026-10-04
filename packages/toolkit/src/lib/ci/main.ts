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
        event: "push",
        branch: "main",
        stopWhen: (entries) => entries.some((entry) => completedVerdict(entry)),
      },
      signal,
    ),
  ]);
  const current = listed.find((entry) => entry.commit === branch.commit.sha);
  const completed = listed.find((entry) => completedVerdict(entry));
  const [latest, lastVerdict] = await Promise.all([
    current === undefined ? null : getPipeline(current.number, config, signal),
    completed === undefined
      ? null
      : getPipeline(completed.number, config, signal),
  ]);
  if (
    latest !== null &&
    (latest.commit !== branch.commit.sha ||
      latest.event !== "push" ||
      latest.ref !== "refs/heads/main")
  ) {
    throw new Error("Main pipeline does not match the current main push");
  }
  if (
    lastVerdict !== null &&
    (lastVerdict.event !== "push" ||
      lastVerdict.ref !== "refs/heads/main" ||
      lastVerdict.commit !== completed?.commit)
  )
    throw new Error(
      "Last main verdict does not match its listed push pipeline",
    );
  return {
    headSha: branch.commit.sha,
    latest,
    lastVerdict,
    state: mainVerdict(latest, lastVerdict),
    url: latest === null ? null : pipelineUrl(latest, config),
  };
}
