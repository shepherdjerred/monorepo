import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

// Grafana Alloy River config: eBPF-sample every pod on the local node kernel-side
// and push profiles to Pyroscope. No application instrumentation — works for the
// Bun + WASM discord-plays bots (and everything else). `service_name` (the label
// Pyroscope groups by) is set to <namespace>/<container>.
const ALLOY_EBPF_CONFIG = `
discovery.kubernetes "local_pods" {
  role = "pod"
  selectors {
    role  = "pod"
    field = "spec.nodeName=" + coalesce(sys.env("NODE_NAME"), "")
  }
}

discovery.relabel "ebpf" {
  targets = discovery.kubernetes.local_pods.targets

  rule {
    source_labels = ["__meta_kubernetes_namespace"]
    target_label  = "namespace"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_name"]
    target_label  = "pod"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_container_name"]
    target_label  = "container"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_node_name"]
    target_label  = "node"
  }
  rule {
    source_labels = ["__meta_kubernetes_namespace", "__meta_kubernetes_pod_container_name"]
    separator     = "/"
    target_label  = "service_name"
  }
}

pyroscope.ebpf "default" {
  forward_to = [pyroscope.write.default.receiver]
  targets    = discovery.relabel.ebpf.output
}

pyroscope.write "default" {
  endpoint {
    url = "http://pyroscope.pyroscope.svc.cluster.local:4040"
  }
}
`;

/**
 * Grafana Alloy as a privileged eBPF profiling DaemonSet feeding Pyroscope.
 *
 * SECURITY: this is a cluster-wide privileged DaemonSet (hostPID + privileged
 * securityContext + CAP_SYS_ADMIN/BPF/PERFMON) — required for kernel-side eBPF
 * profiling of every pod on the node with no app changes. Accepted trade-off for
 * the profiling capability; see packages/docs and the homelab hardening notes.
 * It only pushes profiles to the in-cluster Pyroscope; it has no ingress.
 */
export function createAlloyApp(chart: Chart) {
  // The DaemonSet is privileged (hostPID + privileged container), so the namespace
  // must opt out of the cluster-default "baseline" Pod Security enforcement.
  // CreateNamespace=true creates a bare namespace without these labels, which
  // blocks every pod the daemonset-controller tries to create.
  new Namespace(chart, "alloy-namespace", {
    metadata: {
      name: "alloy",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "privileged",
        "pod-security.kubernetes.io/warn": "privileged",
      },
    },
  });

  const alloyValues = {
    controller: {
      type: "daemonset",
      // eBPF reads host PIDs from /proc; share the host PID namespace.
      hostPID: true,
    },
    alloy: {
      // pyroscope.ebpf is a public-preview component; allow non-stable components.
      stabilityLevel: "experimental",
      // eBPF requires elevated privileges to load BPF programs and read /proc.
      securityContext: {
        privileged: true,
        runAsUser: 0,
        runAsGroup: 0,
        readOnlyRootFilesystem: false,
      },
      // Node name for the local-node pod field selector in the River config.
      extraEnv: [
        {
          name: "NODE_NAME",
          valueFrom: {
            fieldRef: {
              fieldPath: "spec.nodeName",
            },
          },
        },
      ],
      configMap: {
        content: ALLOY_EBPF_CONFIG,
      },
      // Chart default is 10m/50Mi; eBPF profiling actually runs at ~200m/900Mi
      // peak (30d), so request honest steady-state values. No limits — profiling
      // load scales with pod churn and a kill here loses profiles.
      resources: {
        requests: {
          cpu: "100m",
          memory: "512Mi",
        },
      },
    },
  };

  return new Application(chart, "alloy-app", {
    metadata: {
      name: "alloy",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://github.com/grafana/alloy/tree/main/operations/helm/charts/alloy
        repoUrl: "https://grafana.github.io/helm-charts",
        targetRevision: versions.alloy,
        chart: "alloy",
        helm: {
          valuesObject: alloyValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "alloy",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
