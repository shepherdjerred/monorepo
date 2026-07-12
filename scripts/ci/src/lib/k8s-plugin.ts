import { execFileSync } from "node:child_process";

/** CI base image — version read from .buildkite/ci-image/VERSION at pipeline generation time. */
const checkedOutCiBaseVersionRaw = await Bun.file(
  `${import.meta.dir}/../../../../.buildkite/ci-image/VERSION`,
).text();
const CHECKED_OUT_CI_BASE_VERSION = checkedOutCiBaseVersionRaw.trim();

function ciBaseVersion(): string {
  const pullRequest = Bun.env["BUILDKITE_PULL_REQUEST"];
  const baseBranch = Bun.env["BUILDKITE_PULL_REQUEST_BASE_BRANCH"];
  if (pullRequest !== undefined && pullRequest !== "false" && baseBranch) {
    try {
      execFileSync("git", ["fetch", "--depth=1", "origin", baseBranch], {
        stdio: "ignore",
      });
      return execFileSync(
        "git",
        ["show", "FETCH_HEAD:.buildkite/ci-image/VERSION"],
        {
          encoding: "utf8",
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

type ResourceQuantities = {
  cpu: string;
  memory: string;
};

type SecretRef = {
  secretRef: { name: string; optional?: boolean };
};

type PluginContainer = {
  name: string;
  image: string;
  resources: { requests: ResourceQuantities; limits: ResourceQuantities };
  env: { name: string; value: string }[];
  envFrom: SecretRef[];
  volumeMounts?: unknown[];
};

type CheckoutConfig = {
  skip?: boolean;
  cloneFlags?: string;
  fetchFlags?: string;
};

export type K8sPlugin = {
  kubernetes: {
    checkout: CheckoutConfig;
    podSpecPatch: {
      serviceAccountName: string;
      containers: PluginContainer[];
    };
  };
};

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
    cpuLimit?: string;
    memoryLimit?: string;
    secrets?: string[];
  } = {},
): K8sPlugin {
  const secretRefs: SecretRef[] = [
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
            // 2026-07 CI-freeze hardening: limits added so no CI step container
            // is ever unbounded by default, regardless of caller. Callers that
            // pass an explicit tier (see catalog.ts ResourceTier) get
            // tier-appropriate limits; everyone else gets the LIGHT-tier
            // default limit UNLESS their own request would exceed it — the
            // fallback chain falls back to the caller's request before the
            // fixed default, since Kubernetes rejects a pod whose request
            // exceeds its limit (several existing callers pass a custom `cpu`/
            // `memory` request, e.g. "500m", without a matching limit option;
            // defaulting the limit straight to "400m" would reject those).
            // See packages/docs/logs/2026-07-08_torvalds-cluster-health-deep-check.md.
            resources: {
              requests: {
                cpu: opts.cpu ?? "100m",
                memory: opts.memory ?? "256Mi",
              },
              limits: {
                cpu: opts.cpuLimit ?? opts.cpu ?? "400m",
                memory: opts.memoryLimit ?? opts.memory ?? "768Mi",
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

/**
 * Escape hatch for steps that genuinely need the repo source on the BK pod
 * (i.e. they run repo scripts directly on the agent rather than via a Dagger
 * git-URL ref). Re-enables Buildkite's built-in checkout (`--depth=100`) and
 * restores the `buildkite-git-mirrors` mount that {@link k8sPlugin} omits.
 *
 * Only the Greptile PR gate uses this — it shells out to `bun
 * scripts/ci/src/wait-for-greptile.ts` + `buildkite-agent` on the agent. Do
 * not add new callers; new agent-side work should be migrated to Dagger.
 */
export function k8sPluginWithCheckout(
  opts: {
    cpu?: string;
    memory?: string;
    cpuLimit?: string;
    memoryLimit?: string;
    secrets?: string[];
  } = {},
): K8sPlugin {
  const plugin = k8sPlugin(opts);
  plugin.kubernetes.checkout = {
    cloneFlags: "--depth=100",
    fetchFlags: "--depth=100",
  };
  // Restore the git-mirrors volume mount that base k8sPlugin omits.
  const container = plugin.kubernetes.podSpecPatch.containers[0];
  if (container === undefined) {
    throw new Error("k8sPluginWithCheckout: expected container-0");
  }
  container.volumeMounts = [
    {
      name: "buildkite-git-mirrors",
      mountPath: "/buildkite/git-mirrors",
      readOnly: true,
    },
  ];
  return plugin;
}
