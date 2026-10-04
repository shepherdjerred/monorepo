import type { HealthStatus } from "#lib/github/types.ts";

/** Unknown upstream states are contract errors, never success. */
export function workflowStatus(state: string): HealthStatus {
  switch (state.toLowerCase()) {
    case "success":
      return "HEALTHY";
    case "failure":
    case "error":
    case "killed":
    case "canceled":
    case "declined":
    case "skipped":
    case "blocked":
      return "UNHEALTHY";
    case "created":
    case "pending":
    case "running":
    case "started":
    case "waiting":
    case "waiting_on_deps":
      return "PENDING";
    default:
      throw new Error(`Unknown Woodpecker pipeline status: ${state}`);
  }
}

export function isFailure(state: string): boolean {
  return ["failure", "error", "killed", "canceled", "declined"].includes(
    state.toLowerCase(),
  );
}
