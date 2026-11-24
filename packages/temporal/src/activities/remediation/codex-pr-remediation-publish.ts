import {
  activityCancellationSignalOrUndefined,
  startToCloseTimeoutMsOrUndefined,
} from "#activities/agent/agent-task-runtime.ts";
import {
  findOpenSeasonRefreshPr,
  openSeasonRefreshPr,
  type GitCommandRunner,
  type OpenPrInput,
  type OpenPrResult,
  type SeasonRefreshPrLocator,
} from "#activities/scout/scout-season-refresh-git.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  ReportRemediationV1Schema,
  type ReportRemediationV1,
} from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import {
  buildRemediationPrBody,
  configureRemediationPrAutoMerge,
  remediationBranchName,
  unifiedDiffForFiles,
} from "./codex-pr-remediation-git.ts";

const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";

export type RemediationPublishDependencies = {
  mintGitHubToken?: () => Promise<string>;
  findOpenPr?: (locator: SeasonRefreshPrLocator) => Promise<string | undefined>;
  openPr?: (input: OpenPrInput) => Promise<OpenPrResult>;
  configureAutoMerge?: (input: {
    repoDir: string;
    repoSlug: string;
    prUrl: string;
    ghToken: string;
    autoMerge: boolean;
  }) => Promise<boolean>;
};

export function createRemediationActivitySignal(
  callSite: string,
  injectedSignal?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const activitySignal = activityCancellationSignalOrUndefined();
  const timeoutController = new AbortController();
  const timeoutMs = startToCloseTimeoutMsOrUndefined();
  const timeoutTimer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(
          () => {
            timeoutController.abort(
              new Error(
                `${callSite} stopped before Temporal start-to-close timeout`,
              ),
            );
          },
          Math.max(1, timeoutMs - 15_000),
        );
  const signal = AbortSignal.any([
    timeoutController.signal,
    ...(activitySignal === undefined ? [] : [activitySignal]),
    ...(injectedSignal === undefined ? [] : [injectedSignal]),
  ]);
  return {
    signal,
    dispose: () => {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
      }
    },
  };
}

export async function publishVerifiedRemediationPr(input: {
  slug: string;
  prTitle: string;
  prWhy: string;
  prWhat: string;
  repoDir: string;
  tempDir: string;
  verifiedFiles: readonly string[];
  resolvedCount: number;
  unresolvedCount: number;
  verificationSummary: string;
  extraNotes: string | undefined;
  agentNotes: string | undefined;
  autoMerge: boolean;
  signal: AbortSignal;
  commandRunner: GitCommandRunner;
  deps: RemediationPublishDependencies;
}): Promise<ReportRemediationV1> {
  input.signal.throwIfAborted();
  const unifiedDiff = await unifiedDiffForFiles(
    input.repoDir,
    input.verifiedFiles,
    input.commandRunner,
  );
  const branch = remediationBranchName(input.slug, unifiedDiff);
  input.signal.throwIfAborted();
  const ghToken = await (input.deps.mintGitHubToken?.() ??
    createGitHubAppInstallationToken().then((res) => res.token));
  const findOpenPr =
    input.deps.findOpenPr ??
    ((locator) => findOpenSeasonRefreshPr(locator, input.commandRunner));
  const openPr = input.deps.openPr ?? openSeasonRefreshPr;
  const configureAutoMerge =
    input.deps.configureAutoMerge ??
    ((autoMergeInput) =>
      configureRemediationPrAutoMerge({
        ...autoMergeInput,
        commandRunner: input.commandRunner,
      }));
  input.signal.throwIfAborted();
  const existingPrUrl = await findOpenPr({
    repoDir: input.repoDir,
    branch,
    ghToken,
    repoSlug: REPO_SLUG,
    signal: input.signal,
  });
  const outcome = existingPrUrl === undefined ? "pr-created" : "pr-reused";
  const trimmedNotes = (input.agentNotes ?? "").trim();
  const demoContent =
    input.extraNotes ??
    (trimmedNotes === ""
      ? `\`\`\`diff\n${unifiedDiff.slice(0, 1200)}\n\`\`\``
      : trimmedNotes.slice(0, 1500));
  const body = buildRemediationPrBody({
    why: input.prWhy,
    what: input.prWhat,
    changedFiles: input.verifiedFiles,
    resolvedCount: input.resolvedCount,
    unresolvedCount: input.unresolvedCount,
    verificationSummary: input.verificationSummary,
    demo: demoContent,
    autoMerge: input.autoMerge,
  });
  input.signal.throwIfAborted();
  const { commitHash, prUrl } = await openPr({
    repoDir: input.repoDir,
    tempDir: input.tempDir,
    branch,
    title: input.prTitle,
    body,
    files: input.verifiedFiles,
    ghToken,
    repoSlug: REPO_SLUG,
    mainBranch: MAIN_BRANCH,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  const autoMergeEnabled = await configureAutoMerge({
    repoDir: input.repoDir,
    repoSlug: REPO_SLUG,
    prUrl,
    ghToken,
    autoMerge: input.autoMerge,
  });

  return ReportRemediationV1Schema.parse({
    outcome,
    prUrl,
    branchName: branch,
    commitSha: commitHash,
    autoMergeEnabled,
    changedFiles: [...input.verifiedFiles],
    resolvedCount: input.resolvedCount,
    unresolvedCount: input.unresolvedCount,
    summary: input.verificationSummary,
  });
}
