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

function isCanceledStatus(state: string): boolean {
  const normalized = state.toLowerCase();
  return normalized === "canceled" || normalized === "killed";
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

function createPipelineLoader(
  listed: Awaited<ReturnType<typeof listPipelines>>,
  config: WoodpeckerConfig,
  signal?: AbortSignal,
) {
  const cache = new Map<number, Promise<WoodpeckerPipeline>>();
  const load = (
    entry: (typeof listed)[number],
  ): Promise<WoodpeckerPipeline> => {
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

async function isSupersededCanceled(
  status: string,
  number: number,
  hasNewerVerifyingRun: (pipelineNumber: number) => Promise<boolean>,
): Promise<boolean> {
  return isCanceledStatus(status) && (await hasNewerVerifyingRun(number));
}

async function selectMainRuns(
  headSha: string,
  listed: Awaited<ReturnType<typeof listPipelines>>,
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

/** Main runs searched for a pinned commit before reporting none exists yet. */
const PINNED_RUN_WINDOW = 200;

type MainPipelineList = Awaited<ReturnType<typeof listPipelines>>;
type MainPipelineEntry = MainPipelineList[number];

async function readMainWindowThroughCommit(
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

export type MainRunSnapshot = {
  /** The pinned main commit this wait reports on. */
  sha: string;
  /** Main's tip when this snapshot was read. */
  tipSha: string;
  /** The newest run that verifies the pinned commit, if one exists. */
  run: WoodpeckerPipeline | null;
  url: string | null;
};

async function isDescendantCommit(
  github: GitHubClient,
  baseSha: string,
  candidateSha: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (candidateSha === baseSha) return true;
  const comparison = await github.read(
    `/repos/${github.repo}/compare/${baseSha}...${candidateSha}`,
    z.object({
      status: z.enum(["ahead", "behind", "identical", "diverged"]),
    }),
    signal,
  );
  return comparison.status === "ahead";
}

async function earliestNonSupersededDescendant(input: {
  github: GitHubClient;
  sha: string;
  ownRun: WoodpeckerPipeline;
  listed: Awaited<ReturnType<typeof listPipelines>>;
  loader: ReturnType<typeof createPipelineLoader>;
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

type FollowedScanOptions = {
  readonly candidates: MainPipelineList;
  readonly startSha: string;
  readonly tip: string;
  readonly floorNumber: number | null;
  readonly listed: MainPipelineList;
  readonly github: GitHubClient;
  readonly config: WoodpeckerConfig;
  readonly signal: AbortSignal | undefined;
};

type FollowedEntryContext = FollowedScanOptions & {
  readonly entry: MainPipelineEntry;
  readonly ancestryCache: Map<string, boolean>;
};

async function isCommitAtOrAfterStart(
  options: FollowedEntryContext,
): Promise<boolean> {
  const { entry, startSha, tip, floorNumber, listed, github, ancestryCache } =
    options;
  if (entry.commit === startSha || entry.commit === tip) return true;
  if (floorNumber !== null) {
    if (entry.event === "push") return entry.number >= floorNumber;
    const hasPushInWindow = listed.some(
      (item) =>
        item.event === "push" &&
        item.commit === entry.commit &&
        item.number >= floorNumber,
    );
    if (hasPushInWindow) return true;
  }
  const cached = ancestryCache.get(entry.commit);
  if (cached !== undefined) return cached;
  const comparison = await github.read(
    `/repos/${github.repo}/compare/${startSha}...${entry.commit}`,
    z.object({
      status: z.enum(["ahead", "behind", "identical", "diverged"]),
    }),
    options.signal,
  );
  const atOrAfter =
    comparison.status === "ahead" || comparison.status === "identical";
  ancestryCache.set(entry.commit, atOrAfter);
  return atOrAfter;
}

function followedSnapshotFor(
  pipeline: WoodpeckerPipeline | null,
  tip: string,
  config: WoodpeckerConfig,
): MainRunSnapshot {
  const sha = pipeline === null ? tip : pipeline.commit;
  return {
    sha,
    tipSha: tip,
    run: pipeline,
    url: pipeline === null ? null : pipelineUrl(pipeline, config),
  };
}

function classifyFollowedRun(
  pipeline: WoodpeckerPipeline,
): "failed" | "passed" | "pending" {
  const status = workflowStatus(pipeline.status);
  if (status === "UNHEALTHY" || failedWorkflows(pipeline)) return "failed";
  return status === "HEALTHY" && completedVerdict(pipeline)
    ? "passed"
    : "pending";
}

async function loadVerifiedFollowedEntry(
  entry: MainPipelineEntry,
  completedCommits: ReadonlySet<string>,
  options: FollowedScanOptions,
): Promise<WoodpeckerPipeline | null> {
  if (completedCommits.has(entry.commit)) return null;
  const pipeline = await getPipeline(
    entry.number,
    options.config,
    options.signal,
  );
  assertMainIdentity(pipeline, entry);
  return verifiesMain(pipeline) ? pipeline : null;
}

async function followedEntryEligibility(
  options: FollowedEntryContext,
): Promise<"include" | "skip" | "stop"> {
  const eligible = await isCommitAtOrAfterStart(options);
  if (eligible) return "include";
  return options.floorNumber === null && options.entry.event === "push"
    ? "stop"
    : "skip";
}

function classifyAndRecordFollowedRun(
  pipeline: WoodpeckerPipeline,
  completedCommits: Set<string>,
): "failed" | "passed" | "pending" {
  const outcome = classifyFollowedRun(pipeline);
  if (outcome !== "pending") completedCommits.add(pipeline.commit);
  return outcome;
}

async function scanFollowedCandidates(
  options: FollowedScanOptions,
): Promise<WoodpeckerPipeline | null> {
  const { candidates, tip } = options;
  const completedCommits = new Set<string>();
  const ancestryCache = new Map<string, boolean>();
  let tipRun: WoodpeckerPipeline | null = null;
  for (const entry of candidates) {
    const eligibility = await followedEntryEligibility({
      ...options,
      entry,
      ancestryCache,
    });
    if (eligibility === "stop") break;
    if (eligibility === "skip") continue;
    const pipeline = await loadVerifiedFollowedEntry(
      entry,
      completedCommits,
      options,
    );
    if (pipeline === null) continue;
    if (tipRun === null && pipeline.commit === tip) tipRun = pipeline;
    const outcome = classifyAndRecordFollowedRun(pipeline, completedCommits);
    if (outcome === "failed") return tipRun ?? pipeline;
    if (outcome === "passed") return pipeline;
  }
  return tipRun;
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
  const { tip, listed } = await readMainWindowThroughCommit(
    github,
    config,
    startSha,
    signal,
  );
  const startEntries = listed.filter((entry) => entry.commit === startSha);
  const floorNumber =
    startEntries.length === 0
      ? null
      : Math.min(...startEntries.map((entry) => entry.number));
  if (floorNumber === null && tip === startSha) {
    return followedSnapshotFor(null, tip, config);
  }
  const candidates =
    floorNumber === null
      ? listed
      : listed.filter((entry) => entry.number >= floorNumber);
  const selected = await scanFollowedCandidates({
    candidates,
    startSha,
    tip,
    floorNumber,
    listed,
    github,
    config,
    signal,
  });
  return followedSnapshotFor(selected, tip, config);
}
