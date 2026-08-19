import type { z } from "zod";
import type {
  PullRequestSchema,
  ReviewSchema,
  GitHubCheckSchema,
} from "./schemas.ts";

export type PullRequest = z.infer<typeof PullRequestSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type GitHubCheck = z.infer<typeof GitHubCheckSchema>;

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
