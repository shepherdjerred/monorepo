import type { CiStage } from "#shared/hub/integration-contract.ts";
import type { PipelineStatus } from "#shared/hub/hub-contract.ts";

/**
 * Pipeline stage of each Woodpecker workflow. Workflows are named after the
 * CI lane that emits them (packages/woodpecker-config-extension); a new lane
 * shows under "other" until it is placed here.
 */
const WORKFLOW_STAGES: Record<string, CiStage> = {
  images: "build",
  "helm-push": "build",
  sites: "build",
  "scout-site-archives": "build",
  "trmnl-plugin-archives": "build",
  "resume-build": "build",
  "alert-dashboard-sqlite": "build",
  verify: "test",
  "playwright-e2e": "test",
  "docker-e2e": "test",
  "trmnl-validate": "test",
  semgrep: "test",
  trivy: "test",
  "tofu-validate": "test",
  "delivery-publish": "publish",
  publish: "publish",
  "release-please": "publish",
};

export function ciStage(workflow: string): CiStage {
  return WORKFLOW_STAGES[workflow] ?? "other";
}

/** Woodpecker v3 states (`server/model/const.go`) in the hub vocabulary. */
export function woodpeckerStatus(state: string): PipelineStatus {
  switch (state) {
    case "success": {
      return "succeeded";
    }
    case "failure":
    case "error":
    case "killed": {
      return "failed";
    }
    case "running": {
      return "running";
    }
    case "created":
    case "pending": {
      return "pending";
    }
    case "blocked": {
      return "awaiting_approval";
    }
    case "declined":
    case "canceled": {
      return "canceled";
    }
    case "skipped": {
      return "not_started";
    }
    default: {
      throw new Error(`Unknown Woodpecker state ${state}`);
    }
  }
}
