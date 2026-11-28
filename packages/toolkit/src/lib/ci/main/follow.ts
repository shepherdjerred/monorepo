import {
  pipelineUrl,
  type WoodpeckerConfig,
  type WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";
import type { GitHubClient } from "#lib/ci/github.ts";
import { workflowStatus } from "#lib/ci/status.ts";
import {
  compareCommits,
  completedVerdict,
  createPipelineLoader,
  failedWorkflows,
  isSupersededCanceled,
  readMainWindowThroughCommit,
  verifiesMain,
  type MainPipelineEntry,
  type MainPipelineList,
  type MainRunSnapshot,
  type PipelineLoader,
} from "./pipeline.ts";

type FollowedScanOptions = {
  readonly candidates: MainPipelineList;
  readonly startSha: string;
  readonly tip: string;
  readonly floorNumber: number | null;
  readonly listed: MainPipelineList;
  readonly loader: PipelineLoader;
  readonly github: GitHubClient;
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
  const status = await compareCommits(
    github,
    startSha,
    entry.commit,
    options.signal,
  );
  const atOrAfter = status === "ahead" || status === "identical";
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
  loader: PipelineLoader,
): Promise<WoodpeckerPipeline | null> {
  if (completedCommits.has(entry.commit)) return null;
  const pipeline = await loader.load(entry);
  if (!verifiesMain(pipeline)) return null;
  const superseded = await isSupersededCanceled(
    pipeline.status,
    pipeline.number,
    loader.hasNewerVerifyingRun,
  );
  return superseded ? null : pipeline;
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
  const { candidates, tip, loader } = options;
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
      loader,
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
    loader: createPipelineLoader(listed, config, signal),
    github,
    signal,
  });
  return followedSnapshotFor(selected, tip, config);
}
