import type { PipelineStatus } from "#shared/hub/hub-contract.ts";

export function buildStatus(status: string): PipelineStatus {
  switch (status) {
    case "verified": {
      return "succeeded";
    }
    case "failed": {
      return "failed";
    }
    case "pending": {
      return "pending";
    }
    default: {
      throw new Error(`Unknown build status ${status}`);
    }
  }
}

export function stageStatus(status: string): PipelineStatus {
  switch (status) {
    case "running": {
      return "running";
    }
    case "succeeded": {
      return "succeeded";
    }
    case "failed": {
      return "failed";
    }
    default: {
      throw new Error(`Unknown stage status ${status}`);
    }
  }
}

const PRIORITY: PipelineStatus[] = [
  "failed",
  "running",
  "awaiting_approval",
  "queued",
  "pending",
  "canceled",
  "succeeded",
  "not_started",
];

/** The most urgent status among parts; a failure outranks progress. */
export function combinedStatus(parts: PipelineStatus[]): PipelineStatus {
  return PRIORITY.find((status) => parts.includes(status)) ?? "not_started";
}

/** One change's status: its build, then the newest deployment per environment. */
export function executionStatus(
  build: PipelineStatus | null,
  latestPerEnvironment: PipelineStatus[],
): PipelineStatus {
  if (build === "failed" || build === "pending") return build;
  if (latestPerEnvironment.length === 0) return build ?? "not_started";
  const active = latestPerEnvironment.filter((status) => status !== "canceled");
  return combinedStatus(active.length === 0 ? latestPerEnvironment : active);
}
