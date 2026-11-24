import type {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/common";
import type {
  ProviderId,
  PullRequestAuthor,
  ReviewProvider,
  ReviewState,
  ReviewThread,
} from "@shepherdjerred/code-review";
import type { ReviewStateResult } from "@shepherdjerred/code-review/github";
import type { ReviewRequestOutcome } from "@shepherdjerred/code-review/request-review";
import type { CodeReviewRuntimeConfig } from "#config/code-review.ts";
import type { GitHubAppTokenResult } from "#lib/github-app-token.ts";

export type CodeReviewCommitStatusState =
  "pending" | "success" | "failure" | "error";

export type CodeReviewOutcomeReason =
  | "clean"
  | "prior-round"
  | "quota-exempt"
  | "all-skipped"
  | "threads-resolved"
  | "blocking-findings"
  | "p0-veto"
  | "review-withdrawn";

export type InactivePrReason =
  "closed" | "draft" | "base-not-main" | "head-changed";

export type PullRequestMetadata = {
  state: "open" | "closed";
  draft: boolean;
  baseRef: string;
  headSha: string;
  author: PullRequestAuthor;
};

export type OpenMainPrRef = {
  prNumber: number;
  headSha: string;
  baseRef: string;
};

export type InspectPrReviewContextInput = {
  owner: string;
  repo: string;
  prNumber: number;
  expectedHeadSha: string;
};

export type CompletedAtHeadSummary = {
  providerId: ProviderId;
  blockingCount: number;
  message: string;
};

export type InspectPrReviewContextResult =
  | { active: false; reason: InactivePrReason }
  | {
      active: true;
      author: PullRequestAuthor;
      headPushedAt: string | null;
      p0VetoCount: number;
      p0VetoSummary: string | null;
      completedAtHead: CompletedAtHeadSummary | null;
      priorRoundCompleted: boolean;
    };

export type PostCodeReviewCommitStatusInput = {
  owner: string;
  repo: string;
  sha: string;
  state: CodeReviewCommitStatusState;
  description: string;
  targetUrl?: string | undefined;
  reason?: CodeReviewOutcomeReason | undefined;
  durationSeconds?: number | undefined;
  recordOutcome?: boolean | undefined;
};

export type TriggerAndObserveProviderInput = {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  headPushedAt: string | null;
  providerId: ProviderId;
  attempt: number;
  shouldRequest: boolean;
};

export type TriggerAndObserveProviderResult =
  | { active: false; reason: InactivePrReason }
  | {
      active: true;
      reviewState: ReviewState;
      skipReason: string | null;
      blockedReason: string | null;
      requestOutcome: ReviewRequestOutcome | null;
      p0VetoCount: number;
      p0VetoMessage: string | null;
      decisionState: "waiting" | "passed" | "failed";
      decisionMessage: string;
      blockingCount: number;
    };

export type VerifyAndCheckBlockingThreadsInput = {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  providerId: ProviderId | null;
};

export type VerifyFailureReason =
  "p0-veto" | "blocking-findings" | "review-withdrawn";

export type VerifyAndCheckBlockingThreadsResult =
  | { active: false; reason: InactivePrReason }
  | {
      active: true;
      passed: boolean;
      failureReason: VerifyFailureReason | null;
      description: string;
    };

export type CodeReviewTemporalClient = {
  workflow: {
    signalWithStart: (
      workflowType: string,
      options: {
        taskQueue: string;
        workflowId: string;
        workflowIdReusePolicy: WorkflowIdReusePolicy;
        signal: string;
        signalArgs: unknown[];
      },
    ) => Promise<unknown>;
    start: (
      workflowType: string,
      options: {
        taskQueue: string;
        workflowId: string;
        workflowIdReusePolicy: WorkflowIdReusePolicy;
        workflowIdConflictPolicy: WorkflowIdConflictPolicy;
        args: unknown[];
      },
    ) => Promise<unknown>;
  };
};

export type CodeReviewActivityDeps = {
  createInstallationToken?: () => Promise<GitHubAppTokenResult>;
  getReviewToken?: () => string | undefined;
  getTemporalClient?: () => Promise<CodeReviewTemporalClient>;
  getRuntimeConfig?: () => Promise<CodeReviewRuntimeConfig>;
  getPullRequest?: (
    token: string,
    params: { owner: string; repo: string; prNumber: number },
  ) => Promise<PullRequestMetadata>;
  listOpenMainPrs?: (
    token: string,
    params: { owner: string; repo: string },
  ) => Promise<OpenMainPrRef[]>;
  createCommitStatus?: (
    token: string,
    params: {
      owner: string;
      repo: string;
      sha: string;
      context: string;
      state: CodeReviewCommitStatusState;
      description: string;
      targetUrl?: string | undefined;
    },
  ) => Promise<void>;
  fetchHeadPushedAt?: (input: {
    repo: string;
    sha: string;
    prNumber: number;
    token: string;
  }) => Promise<string | null>;
  resolveReviewState?: (input: {
    provider: ReviewProvider;
    repo: string;
    head: string;
    prNumber: number;
    token: string;
    headPushedAt: string | null;
  }) => Promise<ReviewStateResult>;
  fetchSharedProviderThreads?: (input: {
    repo: string;
    number: number;
    token: string;
    providers: readonly ReviewProvider[];
  }) => Promise<{
    byProvider: Map<string, ReviewThread[]>;
    headRefOid: string | null;
  }>;
  requestReviewAtHead?: (input: {
    repo: string;
    number: number;
    head: string;
    token: string;
    requestToken: string;
    provider: ReviewProvider;
    attempt?: number;
  }) => Promise<ReviewRequestOutcome>;
};
