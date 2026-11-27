import { z } from "zod";
import {
  listPipelines,
  pipelineUrl,
  type WoodpeckerConfig,
  type WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";
import type { GitHubClient } from "./github.ts";
import { getFollowedMainSnapshot as readFollowedMainSnapshot } from "./main/follow.ts";
import {
  compareCommits,
  completedVerdict,
  createPipelineLoader,
  failedWorkflows,
  isCanceledStatus,
  isSupersededCanceled,
  readMainTip as fetchMainTip,
  readMainWindowThroughCommit,
  verifiesMain,
  type MainPipelineList,
  type PipelineLoader,
} from "./main/pipeline.ts";
import { workflowStatus } from "./status.ts";

export type MainRunSnapshot = {
  /** The pinned main commit this wait reports on. */
  sha: string;
  /** Main's tip when this snapshot was read. */
  tipSha: string;
  /** The newest run that verifies the pinned commit, if one exists. */
  run: WoodpeckerPipeline | null;
  url: string | null;
};

export type MainStatus = {
  headSha: string;
  latest: WoodpeckerPipeline | null;
  lastVerdict: WoodpeckerPipeline | null;
  state: "green" | "red" | "pending";
  url: string | null;
};

/** Main's current tip commit; `maxAgeMs` accepts a shared read that recent. */
export async function readMainTip(
  github: GitHubClient,
  signal?: AbortSignal,
  maxAgeMs = 0,
): Promise<string> {
  return fetchMainTip(github, signal, maxAgeMs);
}

/**
 * Snapshot for `ci wait --main --follow`: scan main runs from newest back
 * through `startSha`. Any completed green verifying run at or after `startSha`
 * satisfies merge readiness when no newer verifying run has failed.
 */
export async function getFollowedMainSnapshot(
  github: GitHubClient,
  config: WoodpeckerConfig,
  startSha: string,
  signal?: AbortSignal,
): Promise<MainRunSnapshot> {
  return readFollowedMainSnapshot(github, config, startSha, signal);
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

async function selectMainRuns(
  headSha: string,
  listed: MainPipelineList,
  config: WoodpeckerConfig,
  signal?: AbortSignal,
): Promise<Pick<MainStatus, "latest" | "lastVerdict">> {
  const { load, hasNewerVerifyingRun } = createPipelineLoader(
    listed,
    config,
    signal,
  );
  let latest: WoodpeckerPipeline | null = null;
  let lastVerdict: WoodpeckerPipeline | null = null;
  for (const entry of listed) {
    const needsCurrent = latest === null && entry.commit === headSha;
    const needsVerdict = lastVerdict === null && completedVerdict(entry);
    if (!needsCurrent && !needsVerdict) continue;
    const pipeline = await load(entry);
    if (!verifiesMain(pipeline)) continue;
    if (needsCurrent) latest = pipeline;
    if (
      lastVerdict === null &&
      completedVerdict(pipeline) &&
      !(await isSupersededCanceled(
        pipeline.status,
        pipeline.number,
        hasNewerVerifyingRun,
      ))
    ) {
      lastVerdict = pipeline;
    }
  }
  return { latest, lastVerdict };
}

const CommitShaSchema = z.object({
  sha: z.string().regex(/^[a-f\d]{40}$/iu),
});

/** Expand a 7–39 character hex prefix through GitHub; full 40-hex SHAs pass through. */
export async function resolveMainHeadSha(
  github: GitHubClient,
  head: string,
  signal?: AbortSignal,
): Promise<string> {
  const normalized = head.toLowerCase();
  if (/^[a-f\d]{40}$/u.test(normalized)) return normalized;
  const commit = await github.read(
    `/repos/${github.repo}/commits/${encodeURIComponent(normalized)}`,
    CommitShaSchema,
    signal,
  );
  return commit.sha.toLowerCase();
}

/** Throws unless `sha` is main's tip or one of its ancestors. */
export async function assertOnMain(
  github: GitHubClient,
  sha: string,
  signal?: AbortSignal,
): Promise<void> {
  const status = await compareCommits(github, sha, "main", signal);
  if (status !== "ahead" && status !== "identical")
    throw new Error(`${sha} is not on main (main is ${status})`);
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
        // A completed manual run may be partial, and a canceled push may be
        // superseded. Read until a non-canceled completed push bounds the last
        // main verdict.
        stopWhen: (entries) =>
          entries.some(
            (entry) =>
              entry.event === "push" &&
              completedVerdict(entry) &&
              !isCanceledStatus(entry.status),
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

async function isDescendantCommit(
  github: GitHubClient,
  baseSha: string,
  candidateSha: string,
  signal?: AbortSignal,
): Promise<boolean> {
  return (
    candidateSha === baseSha ||
    (await compareCommits(github, baseSha, candidateSha, signal)) === "ahead"
  );
}

async function earliestNonSupersededDescendant(input: {
  github: GitHubClient;
  sha: string;
  ownRun: WoodpeckerPipeline;
  listed: MainPipelineList;
  loader: PipelineLoader;
  signal?: AbortSignal | undefined;
}): Promise<WoodpeckerPipeline> {
  const { github, sha, ownRun, listed, loader, signal } = input;
  const newerAscending = listed
    .filter((entry) => entry.number > ownRun.number)
    .toSorted((a, b) => a.number - b.number);
  for (const entry of newerAscending) {
    if (
      await isSupersededCanceled(
        entry.status,
        entry.number,
        loader.hasNewerVerifyingRun,
      )
    )
      continue;
    const candidate = await loader.load(entry);
    if (!verifiesMain(candidate)) continue;
    if (
      await isSupersededCanceled(
        candidate.status,
        candidate.number,
        loader.hasNewerVerifyingRun,
      )
    )
      continue;
    if (await isDescendantCommit(github, sha, candidate.commit, signal))
      return candidate;
  }
  return ownRun;
}

/** The newest verifying main run for one exact commit. */
export async function getMainRun(
  github: GitHubClient,
  config: WoodpeckerConfig,
  sha: string,
  signal?: AbortSignal,
): Promise<MainRunSnapshot> {
  const { tip, listed } = await readMainWindowThroughCommit(
    github,
    config,
    sha,
    signal,
  );
  const loader = createPipelineLoader(listed, config, signal);
  let run: WoodpeckerPipeline | null = null;
  for (const entry of listed) {
    if (entry.commit !== sha) continue;
    const pipeline = await loader.load(entry);
    if (!verifiesMain(pipeline)) continue;
    run = pipeline;
    break;
  }
  if (run !== null && isCanceledStatus(run.status)) {
    run = await earliestNonSupersededDescendant({
      github,
      sha,
      ownRun: run,
      listed,
      loader,
      signal,
    });
  }
  return {
    sha,
    tipSha: tip,
    run,
    url: run === null ? null : pipelineUrl(run, config),
  };
}
