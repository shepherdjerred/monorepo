import type { Snapshot } from "#lib/ci/readiness.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";

export const CI_HEAD = "a".repeat(40);
export const CI_BASE = "b".repeat(40);
export const CI_PIPELINE_URL = "https://woodpecker.sjer.red/repos/1/pipeline/7";

export const MAIN_WOODPECKER_CONFIG = {
  baseUrl: "https://woodpecker.sjer.red",
  token: "test",
  repoId: 1,
};

const MAIN_REQUIRED_WORKFLOWS = [
  "verify",
  "homelab-release-admission",
  "images",
  "helm-push",
  "argocd-sync",
];

export function mainPipeline(
  number: number,
  event: string,
  status = "success",
): WoodpeckerPipeline {
  return {
    number,
    event,
    status,
    commit: CI_HEAD,
    branch: "main",
    ref: "refs/heads/main",
    finished: status === "running" ? 0 : number,
    workflows: MAIN_REQUIRED_WORKFLOWS.map((name) => ({ name, state: status })),
  };
}

export function ciFixture(): Snapshot {
  return {
    pr: {
      number: 99,
      html_url: "https://github.com/shepherdjerred/monorepo/pull/99",
      state: "open",
      merged: false,
      draft: false,
      mergeable: true,
      mergeable_state: "clean",
      head: { sha: CI_HEAD },
      base: { sha: CI_BASE, ref: "main" },
    },
    pipeline: {
      number: 7,
      commit: CI_HEAD,
      status: "success",
      event: "pull_request",
      ref: "refs/pull/99/merge",
      rerun_count: 0,
      workflows: [
        { name: "verify", state: "success" },
        { name: "ci-complete", state: "success" },
      ],
    },
    main: {
      headSha: CI_BASE,
      latest: null,
      lastVerdict: null,
      state: "pending",
      url: null,
    },
    rules: {
      strict: false,
      approvals: 0,
      checks: [
        { name: "ci/merge-conflict", appId: null },
        { name: "ci/woodpecker/pr/ci-complete", appId: null },
      ],
    },
    checks: [
      { name: "ci/merge-conflict", state: "pass", url: null, appId: null },
      {
        name: "ci/woodpecker/pr/ci-complete",
        state: "pass",
        url: `${CI_PIPELINE_URL}/2`,
        appId: null,
      },
    ],
    reviews: [],
    reviewDecision: null,
    consistent: true,
    pipelineUrl: CI_PIPELINE_URL,
  };
}

export function pendingCi(): Snapshot {
  const snapshot = ciFixture();
  snapshot.pipeline = {
    number: 7,
    commit: CI_HEAD,
    status: "running",
    workflows: [
      { name: "verify", state: "running" },
      { name: "ci-complete", state: "pending" },
    ],
  };
  snapshot.checks = snapshot.checks.map((check) => ({
    ...check,
    state: "pending",
  }));
  return snapshot;
}
