import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubePersistentVolumeClaim,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

/**
 * Grafana Pyroscope — continuous-profiling store. Profiles are pushed by the
 * Grafana Alloy eBPF DaemonSet (see alloy.ts), which samples every pod on each
 * node kernel-side (no app instrumentation), so we can see exactly where the
 * discord-plays bots spend CPU (wasm emulation vs ffmpeg vs frame copy).
 *
 * Monolithic single-binary deployment, suitable for homelab scale. The query
 * API + ingest endpoint live at pyroscope.pyroscope.svc.cluster.local:4040 and
 * are wired into Grafana as a datasource (grafana-values.ts).
 */
export function createPyroscopeNamespace(chart: Chart): void {
  new Namespace(chart, "pyroscope-namespace", {
    metadata: {
      name: "pyroscope",
      annotations: { "argocd.argoproj.io/sync-wave": "-2" },
    },
  });
}

export function createPyroscopeApp(chart: Chart) {
  createPyroscopeNamespace(chart);
  // Expand the existing claim without replacing the immutable StatefulSet
  // template. At ~0.94 GB/day, its 32 GiB quota projected full in 17 days.
  new KubePersistentVolumeClaim(chart, "pyroscope-existing-claim-capacity", {
    metadata: {
      name: "data-pyroscope-0",
      namespace: "pyroscope",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
      annotations: {
        "argocd.argoproj.io/sync-wave": "-1",
        "argocd.argoproj.io/sync-options": "Prune=false",
      },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: NVME_STORAGE_CLASS,
      resources: { requests: { storage: Quantity.fromString("128Gi") } },
    },
  });
  const pyroscopeValues: HelmValuesForChart<"pyroscope"> = {
    pyroscope: {
      // Default chart mode is the all-in-one "pyroscope" target — keep a single
      // replica for homelab scale.
      persistence: {
        enabled: true,
        storageClassName: NVME_STORAGE_CLASS,
        // Keep this immutable template unchanged; the explicit claim above
        // owns capacity for both existing installations and fresh installs.
        size: Size.gibibytes(32).asString(),
      },
      // Baseline request (no limits) so the profiling store isn't BestEffort.
      // 30d peak ~35m / ~200Mi.
      resources: {
        requests: {
          cpu: "50m",
          memory: "256Mi",
        },
      },
      // The chart defaults to debug: ~3.4M lines a day, over a third of
      // everything Loki ingests.
      extraArgs: {
        "log.level": "info",
      },
    },
    // No bundled agent — profiles arrive from our dedicated Alloy eBPF
    // DaemonSet (alloy.ts). The chart's subchart key is `alloy`, not
    // `alloy-stack`; the old key was a silent no-op, so the chart's default
    // (alloy.enabled = true) left a redundant `pyroscope-alloy-0` StatefulSet
    // running. Typing this values object surfaced the typo.
    alloy: {
      enabled: false,
    },
  };

  return new Application(chart, "pyroscope-app", {
    metadata: {
      name: "pyroscope",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("pyroscope"),
      source: {
        // https://github.com/grafana/pyroscope/tree/main/operations/pyroscope/helm/pyroscope
        repoUrl: "https://grafana.github.io/helm-charts",
        targetRevision: versions.pyroscope,
        chart: "pyroscope",
        helm: {
          valuesObject: pyroscopeValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "pyroscope",
      },
      // StatefulSet volume-claim templates are immutable after creation, and
      // Kubernetes defaults fields inside the live template. Chart 2.2.1
      // additionally renders an empty `annotations: {}` there that 2.2.0 — the
      // version live before the #2313 Renovate sweep — did not, so the
      // apply-safety preflight refused every pyroscope sync from that bump
      // onward and reddened main build 10784, even though the storage class,
      // size, and access modes are byte-identical.
      //
      // Ignore the whole field, exactly as loki and the three itzg Minecraft
      // Applications do. Not a pointer into the list: the preflight
      // deliberately refuses those, because dropping one entry renumbers its
      // siblings and the pruned document would stop describing what Argo
      // applies (see argocd-ignored-differences.test.ts). PVC backup labels on
      // the created claims are enforced by the cluster-wide admission policy,
      // not by this comparison.
      ignoreDifferences: [
        {
          group: "apps",
          kind: "StatefulSet",
          name: "pyroscope",
          namespace: "pyroscope",
          jsonPointers: ["/spec/volumeClaimTemplates"],
        },
      ],
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: [
          "CreateNamespace=true",
          "ServerSideApply=true",
          // Required for the ignoreDifferences above to actually keep the path
          // at its live value; without it the field is still applied.
          "RespectIgnoreDifferences=true",
        ],
      },
    },
  });
}
