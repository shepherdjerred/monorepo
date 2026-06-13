import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

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
export function createPyroscopeApp(chart: Chart) {
  const pyroscopeValues: HelmValuesForChart<"pyroscope"> = {
    pyroscope: {
      // Default chart mode is the all-in-one "pyroscope" target — keep a single
      // replica for homelab scale.
      persistence: {
        enabled: true,
        storageClassName: NVME_STORAGE_CLASS,
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
      project: "default",
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
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
