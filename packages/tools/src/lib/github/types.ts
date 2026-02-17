export type PullRequest = {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
};

export type Review = {
  author: {
    login: string;
  };
  state:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "COMMENTED"
    | "PENDING"
    | "DISMISSED";
  submittedAt: string;
};

export type CheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string;
  workflowName: string;
};

export type WorkflowRun = {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
};

export type HealthStatus = "HEALTHY" | "UNHEALTHY" | "PENDING";

export type HealthCheck = {
  name: string;
  status: HealthStatus;
  details: string[];
  commands?: string[];
};

export type HealthReport = {
  prNumber: number;
  prUrl: string;
  overallStatus: HealthStatus;
  checks: HealthCheck[];
  nextSteps: string[];
};
