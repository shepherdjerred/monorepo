import { ApplicationFailure } from "@temporalio/common";
import {
  evaluateGate,
  isBlocking,
  isProviderAuthor,
  PROVIDERS,
  ProviderIdSchema,
  resolveProvider,
  STRICT_P0_P1_POLICY,
  vetoThreads,
  type ProviderGateSnapshot,
  type ProviderId,
  type ReviewProvider,
  type ReviewThread,
} from "@shepherdjerred/code-review";
import {
  resolveReviewState as defaultResolveReviewState,
  type ReviewStateResult,
} from "@shepherdjerred/code-review/github";
import { fetchSharedProviderThreads as defaultFetchSharedProviderThreads } from "@shepherdjerred/code-review/github-review-snapshot";
import { fetchHeadPushedAt as defaultFetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import { requestReviewAtHead as defaultRequestReviewAtHead } from "@shepherdjerred/code-review/request-review";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  defaultGetPullRequest,
  defaultGetReviewToken,
} from "./code-review-octokit.ts";
import type {
  CodeReviewActivityDeps,
  CompletedAtHeadSummary,
  InactivePrReason,
  InspectPrReviewContextInput,
  InspectPrReviewContextResult,
  PullRequestMetadata,
  TriggerAndObserveProviderInput,
  TriggerAndObserveProviderResult,
  VerifyAndCheckBlockingThreadsInput,
  VerifyAndCheckBlockingThreadsResult,
} from "./code-review-types.ts";

const ALL_PROVIDER_IDS: readonly ProviderId[] = ProviderIdSchema.options;
const ALL_PROVIDERS: readonly ReviewProvider[] = ALL_PROVIDER_IDS.map(
  (id) => PROVIDERS[id],
);

function checkActivePullRequest(
  pr: PullRequestMetadata,
  expectedHeadSha: string,
): InactivePrReason | null {
  if (pr.state !== "open") {
    return "closed";
  }
  if (pr.draft) {
    return "draft";
  }
  if (pr.baseRef !== "main") {
    return "base-not-main";
  }
  return pr.headSha === expectedHeadSha ? null : "head-changed";
}

function buildAllProviderSnapshots(
  byProvider: ReadonlyMap<string, ReviewThread[]>,
  statesByProvider?: ReadonlyMap<ProviderId, ReviewStateResult>,
): ProviderGateSnapshot[] {
  return ALL_PROVIDER_IDS.map((id) => {
    const provider = PROVIDERS[id];
    const state = statesByProvider?.get(id);
    return {
      provider,
      reviewState: state?.state ?? "reviewing",
      threads: byProvider.get(id) ?? [],
      skipReason: state?.skipReason ?? null,
      blockedReason: state?.blockedReason ?? null,
      ...(state?.priorRound === undefined
        ? {}
        : { priorRound: state.priorRound }),
    };
  });
}

function summarizeVetoes(snapshots: readonly ProviderGateSnapshot[]): {
  p0VetoCount: number;
  p0VetoSummary: string | null;
} {
  const vetoes = vetoThreads(snapshots);
  if (vetoes.length === 0) {
    return { p0VetoCount: 0, p0VetoSummary: null };
  }
  const names = [
    ...new Set(vetoes.map(({ provider }) => provider.displayName)),
  ].join(", ");
  return {
    p0VetoCount: vetoes.length,
    p0VetoSummary: `${String(vetoes.length)} unresolved P0 finding(s) (${names})`,
  };
}

function findCompletedAtHead(
  headSha: string,
  byProvider: ReadonlyMap<string, ReviewThread[]>,
  statesByProvider: ReadonlyMap<ProviderId, ReviewStateResult>,
): CompletedAtHeadSummary | null {
  for (const id of ALL_PROVIDER_IDS) {
    const state = statesByProvider.get(id);
    if (state?.state !== "reviewed" || state.skipReason !== null) {
      continue;
    }
    const provider = PROVIDERS[id];
    const threads = byProvider.get(id) ?? [];
    const decision = evaluateGate({
      head: headSha,
      provider,
      reviewState: "reviewed",
      threads,
      policy: STRICT_P0_P1_POLICY,
      skipReason: null,
      blockedReason: null,
    });
    const blockingCount = threads.filter((thread) =>
      isBlocking(thread, provider, STRICT_P0_P1_POLICY),
    ).length;
    return {
      providerId: id,
      blockingCount,
      message: decision.message,
    };
  }
  return null;
}

function hasPriorRoundCompleted(
  expectedHeadSha: string,
  byProvider: ReadonlyMap<string, ReviewThread[]>,
  statesByProvider: ReadonlyMap<ProviderId, ReviewStateResult>,
): boolean {
  for (const id of ALL_PROVIDER_IDS) {
    const state = statesByProvider.get(id);
    if (state === undefined) {
      continue;
    }
    if (state.priorRound === true) {
      return true;
    }
    if (
      state.reviewedCommit !== null &&
      state.reviewedCommit !== expectedHeadSha
    ) {
      return true;
    }
    const provider = PROVIDERS[id];
    const threads = byProvider.get(id) ?? [];
    const hasOutdatedThreads = threads.some(
      (thread) =>
        isProviderAuthor(provider, thread.authorLogin) && thread.isOutdated,
    );
    if (hasOutdatedThreads) {
      return true;
    }
  }
  return false;
}

function requireReviewToken(deps: CodeReviewActivityDeps): string {
  const raw = (deps.getReviewToken ?? defaultGetReviewToken)();
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") {
    throw ApplicationFailure.nonRetryable(
      "GITHUB_REVIEW_TOKEN is required to post provider review request comments",
      "MissingGitHubReviewToken",
    );
  }
  return trimmed;
}

type ActivePrSession =
  | { active: false; reason: InactivePrReason }
  | {
      active: true;
      token: string;
      pr: PullRequestMetadata;
      repoSlug: string;
    };

async function resolveActivePrSession(
  target: {
    owner: string;
    repo: string;
    prNumber: number;
    headSha: string;
  },
  deps: CodeReviewActivityDeps,
): Promise<ActivePrSession> {
  const createToken =
    deps.createInstallationToken ?? createGitHubAppInstallationToken;
  const getPr = deps.getPullRequest ?? defaultGetPullRequest;
  const { token } = await createToken();
  const pr = await getPr(token, {
    owner: target.owner,
    repo: target.repo,
    prNumber: target.prNumber,
  });
  const inactiveReason = checkActivePullRequest(pr, target.headSha);
  if (inactiveReason !== null) {
    return { active: false, reason: inactiveReason };
  }
  return {
    active: true,
    token,
    pr,
    repoSlug: `${target.owner}/${target.repo}`,
  };
}

export async function inspectPrReviewContextImpl(
  input: InspectPrReviewContextInput,
  deps: CodeReviewActivityDeps,
): Promise<InspectPrReviewContextResult> {
  const getHeadPushedAt = deps.fetchHeadPushedAt ?? defaultFetchHeadPushedAt;
  const resolveState = deps.resolveReviewState ?? defaultResolveReviewState;
  const getSharedThreads =
    deps.fetchSharedProviderThreads ?? defaultFetchSharedProviderThreads;

  const session = await resolveActivePrSession(
    {
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      headSha: input.expectedHeadSha,
    },
    deps,
  );
  if (!session.active) {
    return session;
  }
  const { token, pr, repoSlug } = session;
  const headPushedAt = await getHeadPushedAt({
    repo: repoSlug,
    sha: input.expectedHeadSha,
    prNumber: input.prNumber,
    token,
  });

  // Safety invariant: resolve completion for every provider BEFORE fetching the
  // shared thread snapshot (never concurrently), so a provider that finishes
  // mid-inspection cannot read as completed with missing threads.
  const statesByProvider = new Map<ProviderId, ReviewStateResult>();
  for (const id of ALL_PROVIDER_IDS) {
    const state = await resolveState({
      provider: PROVIDERS[id],
      repo: repoSlug,
      head: input.expectedHeadSha,
      prNumber: input.prNumber,
      token,
      headPushedAt,
    });
    statesByProvider.set(id, state);
  }

  const { byProvider, headRefOid } = await getSharedThreads({
    repo: repoSlug,
    number: input.prNumber,
    token,
    providers: ALL_PROVIDERS,
  });
  if (headRefOid !== null && headRefOid !== input.expectedHeadSha) {
    return { active: false, reason: "head-changed" };
  }

  const snapshots = buildAllProviderSnapshots(byProvider, statesByProvider);
  const { p0VetoCount, p0VetoSummary } = summarizeVetoes(snapshots);
  const completedAtHead = findCompletedAtHead(
    input.expectedHeadSha,
    byProvider,
    statesByProvider,
  );
  const priorRoundCompleted = hasPriorRoundCompleted(
    input.expectedHeadSha,
    byProvider,
    statesByProvider,
  );

  return {
    active: true,
    author: pr.author,
    headPushedAt,
    p0VetoCount,
    p0VetoSummary,
    completedAtHead,
    priorRoundCompleted,
  };
}

export async function triggerAndObserveProviderImpl(
  input: TriggerAndObserveProviderInput,
  deps: CodeReviewActivityDeps,
): Promise<TriggerAndObserveProviderResult> {
  const resolveState = deps.resolveReviewState ?? defaultResolveReviewState;
  const getSharedThreads =
    deps.fetchSharedProviderThreads ?? defaultFetchSharedProviderThreads;
  const requestReview = deps.requestReviewAtHead ?? defaultRequestReviewAtHead;

  const session = await resolveActivePrSession(input, deps);
  if (!session.active) {
    return session;
  }
  const { token, repoSlug } = session;
  const provider = resolveProvider(input.providerId);

  // Safety invariant: resolve completion BEFORE fetching threads.
  const state = await resolveState({
    provider,
    repo: repoSlug,
    head: input.headSha,
    prNumber: input.prNumber,
    token,
    headPushedAt: input.headPushedAt,
  });

  const { byProvider, headRefOid } = await getSharedThreads({
    repo: repoSlug,
    number: input.prNumber,
    token,
    providers: ALL_PROVIDERS,
  });
  if (headRefOid !== null && headRefOid !== input.headSha) {
    return { active: false, reason: "head-changed" };
  }

  let requestOutcome = null;
  if (
    input.shouldRequest &&
    state.state === "reviewing" &&
    state.blockedReason === null
  ) {
    const requestToken = requireReviewToken(deps);
    requestOutcome = await requestReview({
      repo: repoSlug,
      number: input.prNumber,
      head: input.headSha,
      token,
      requestToken,
      provider,
      attempt: input.attempt,
    });
  }

  const snapshots = buildAllProviderSnapshots(byProvider);
  const { p0VetoCount, p0VetoSummary } = summarizeVetoes(snapshots);
  const providerThreads = byProvider.get(provider.id) ?? [];
  const decision = evaluateGate({
    head: input.headSha,
    provider,
    reviewState: state.state,
    threads: providerThreads,
    policy: STRICT_P0_P1_POLICY,
    skipReason: state.skipReason,
    blockedReason: state.blockedReason,
  });
  const blockingCount = providerThreads.filter((thread) =>
    isBlocking(thread, provider, STRICT_P0_P1_POLICY),
  ).length;

  return {
    active: true,
    reviewState: state.state,
    skipReason: state.skipReason,
    blockedReason: state.blockedReason,
    requestOutcome,
    p0VetoCount,
    p0VetoMessage: p0VetoSummary,
    decisionState: decision.state,
    decisionMessage: decision.message,
    blockingCount,
  };
}

export async function verifyAndCheckBlockingThreadsImpl(
  input: VerifyAndCheckBlockingThreadsInput,
  deps: CodeReviewActivityDeps,
): Promise<VerifyAndCheckBlockingThreadsResult> {
  const getHeadPushedAt = deps.fetchHeadPushedAt ?? defaultFetchHeadPushedAt;
  const resolveState = deps.resolveReviewState ?? defaultResolveReviewState;
  const getSharedThreads =
    deps.fetchSharedProviderThreads ?? defaultFetchSharedProviderThreads;

  const session = await resolveActivePrSession(input, deps);
  if (!session.active) {
    return session;
  }
  const { token, repoSlug } = session;
  const provider =
    input.providerId === null ? null : resolveProvider(input.providerId);

  let providerState: ReviewStateResult | null = null;
  if (provider !== null) {
    const headPushedAt = await getHeadPushedAt({
      repo: repoSlug,
      sha: input.headSha,
      prNumber: input.prNumber,
      token,
    });
    providerState = await resolveState({
      provider,
      repo: repoSlug,
      head: input.headSha,
      prNumber: input.prNumber,
      token,
      headPushedAt,
    });
  }

  const { byProvider, headRefOid } = await getSharedThreads({
    repo: repoSlug,
    number: input.prNumber,
    token,
    providers: ALL_PROVIDERS,
  });
  if (headRefOid !== null && headRefOid !== input.headSha) {
    return { active: false, reason: "head-changed" };
  }

  const snapshots = buildAllProviderSnapshots(byProvider);
  const { p0VetoSummary } = summarizeVetoes(snapshots);
  if (p0VetoSummary !== null) {
    return {
      active: true,
      passed: false,
      failureReason: "p0-veto",
      description: p0VetoSummary,
    };
  }

  if (provider === null || providerState === null) {
    return {
      active: true,
      passed: true,
      failureReason: null,
      description: "No unresolved P0 findings",
    };
  }

  if (providerState.state !== "reviewed" || providerState.skipReason !== null) {
    return {
      active: true,
      passed: false,
      failureReason: "review-withdrawn",
      description: `${provider.displayName} review for ${input.headSha.slice(0, 7)} is no longer completed`,
    };
  }

  const providerThreads = byProvider.get(provider.id) ?? [];
  const blocking = providerThreads.filter((thread) =>
    isBlocking(thread, provider, STRICT_P0_P1_POLICY),
  );
  if (blocking.length > 0) {
    return {
      active: true,
      passed: false,
      failureReason: "blocking-findings",
      description: `${String(blocking.length)} unresolved P0/P1 finding(s) from ${provider.displayName}`,
    };
  }

  return {
    active: true,
    passed: true,
    failureReason: null,
    description: `${provider.displayName} reviewed clean (no unresolved P0/P1 findings)`,
  };
}
