import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/** CI base image — version read from .buildkite/ci-image/VERSION at pipeline generation time. */
const CHECKED_OUT_CI_BASE_VERSION = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../.buildkite/ci-image/VERSION",
  ),
  "utf-8",
).trim();

function ciBaseVersion(): string {
  const pullRequest = process.env["BUILDKITE_PULL_REQUEST"];
  const baseBranch = process.env["BUILDKITE_PULL_REQUEST_BASE_BRANCH"];
  if (pullRequest !== undefined && pullRequest !== "false" && baseBranch) {
    try {
      execFileSync("git", ["fetch", "--depth=1", "origin", baseBranch], {
        stdio: "ignore",
      });
      return execFileSync(
        "git",
        ["show", "FETCH_HEAD:.buildkite/ci-image/VERSION"],
        {
          encoding: "utf-8",
        },
      ).trim();
    } catch {
      return CHECKED_OUT_CI_BASE_VERSION;
    }
  }
  return CHECKED_OUT_CI_BASE_VERSION;
}

const CI_BASE_VERSION = ciBaseVersion();
const CI_BASE_IMAGE = `ghcr.io/shepherdjerred/ci-base:${CI_BASE_VERSION}`;

/**
 * Build the Kubernetes plugin config for a Buildkite step.
 *
 * Checkout is **skipped** — the step's command is expected to use Dagger
 * CLI git-URL refs (see `REPO_GIT_REF` in lib/buildkite.ts) so that source
 * materialization happens inside the persistent Dagger engine, not in the
 * BK pod. This avoids the ~1.3 GiB per-pod git clone that dominated
 * `nvme1n1` write pressure (see
 * `packages/docs/plans/2026-05-31_bk-dagger-git-url-refactor.md`).
 */
export function k8sPlugin(
  opts: {
    cpu?: string;
    memory?: string;
    secrets?: string[];
  } = {},
): Record<string, unknown> {
  const secretRefs: Record<string, unknown>[] = [
    { secretRef: { name: "buildkite-ci-secrets" } },
  ];

  for (const s of opts.secrets ?? []) {
    secretRefs.push({ secretRef: { name: s, optional: true } });
  }

  return {
    kubernetes: {
      // Skip Buildkite's built-in `git clone`. Each pod used to materialize
      // a 1.3 GiB working tree into emptyDir; with ~1,100 pods/hr that was
      // ~92% of writes to the system NVMe. Dagger now reads the repo via
      // git URL refs (see `REPO_GIT_REF` in lib/buildkite.ts), so the BK
      // pod never needs the source on local disk. PR2 of the plan migrates
      // remaining plain steps to Dagger; after that, the
      // `buildkite-git-mirrors` PVC can be deleted entirely.
      checkout: { skip: true },
      podSpecPatch: {
        serviceAccountName: "buildkite-agent-stack-k8s-controller",
        containers: [
          {
            name: "container-0",
            image: CI_BASE_IMAGE,
            resources: {
              requests: {
                cpu: opts.cpu ?? "100m",
                memory: opts.memory ?? "256Mi",
              },
            },
            env: [
              {
                name: "_EXPERIMENTAL_DAGGER_RUNNER_HOST",
                value: "tcp://dagger-engine.dagger.svc.cluster.local:8080",
              },
            ],
            envFrom: secretRefs,
          },
        ],
      },
    },
  };
}
