import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

// The Kueue Helm chart uses a single YAML string for the entire controller config.
// Individual top-level values don't work — must override the full controllerManagerConfigYaml.
const KUEUE_CONFIG_YAML = `
apiVersion: config.kueue.x-k8s.io/v1beta2
kind: Configuration
manageJobsWithoutQueueName: true
managedJobsNamespaceSelector:
  matchLabels:
    kueue.x-k8s.io/managed-namespace: "true"
health:
  healthProbeBindAddress: :8081
metrics:
  bindAddress: :8443
webhook:
  port: 9443
leaderElection:
  leaderElect: true
  resourceName: c1f6bfd2.kueue.x-k8s.io
  # Defaults (15s lease / 10s renew) lost leadership ~every 10-15 min under
  # CI load on the shared single node (19 restarts on 2026-07-18 alone —
  # each one a webhook outage that wedged or phantomed CI jobs; see
  # packages/docs/todos/torvalds-controller-restart-churn.md). Generous
  # deadlines are safe on a single-replica install: there is no competing
  # candidate, so slow renewal beats process suicide.
  leaseDuration: 60s
  renewDeadline: 40s
  retryPeriod: 5s
controller:
  groupKindConcurrency:
    Job.batch: 5
    Pod: 5
    Workload.kueue.x-k8s.io: 5
    LocalQueue.kueue.x-k8s.io: 1
    ClusterQueue.kueue.x-k8s.io: 1
    ResourceFlavor.kueue.x-k8s.io: 1
clientConnection:
  qps: 50
  burst: 100
integrations:
  frameworks:
    - batch/job
`.trim();

export function createKueueApp(chart: Chart) {
  new Namespace(chart, "kueue-namespace", {
    metadata: {
      name: "kueue-system",
    },
  });

  const kueueValues: HelmValuesForChart<"kueue"> = {
    controllerManager: {
      manager: {
        priorityClassName: "infrastructure-critical",
        // Back to the chart-default requests: the 100m/256Mi downsizing was
        // measured against pre-replatform load, and a 100m CPU weight gets
        // starved during the static pipeline's build bursts — missed lease
        // renewals crash-looped kueue (2026-07-18). Requests are the cgroup
        // weight under contention; this is a correctness knob here, not a
        // capacity one.
        resources: {
          requests: {
            cpu: "500m",
            memory: "512Mi",
          },
          limits: {
            cpu: "2000m",
            memory: "1Gi",
          },
        },
      },
    },
    managerConfig: {
      controllerManagerConfigYaml: KUEUE_CONFIG_YAML,
    },
  };

  return new Application(chart, "kueue-app", {
    metadata: {
      name: "kueue",
      annotations: {
        // Deploy early so the webhook is ready before Buildkite creates Jobs
        "argocd.argoproj.io/sync-wave": "1",
      },
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "registry.k8s.io/kueue/charts",
        chart: "kueue",
        targetRevision: versions.kueue.split("@")[0] ?? versions.kueue,
        helm: {
          valuesObject: kueueValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "kueue-system",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
