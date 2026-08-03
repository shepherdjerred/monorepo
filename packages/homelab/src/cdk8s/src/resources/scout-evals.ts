import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";

// Scout review evals: the post-match review calibration app
// (packages/scout-for-lol/packages/evals). Single Bun process serving the
// built client + tRPC API over one WAL-mode SQLite file on a PVC. The app has
// NO auth by design — the tailnet-only TailscaleIngress is the entire trust
// boundary. Never expose it via Funnel.
export function createScoutEvalsDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "scout-evals", {
    replicas: 1,
    // Single-writer SQLite on an RWO ZFS volume: never run old and new pods
    // concurrently.
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: 1000,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Bun writes runtime caches under HOME; app data lives on the PVC",
      },
    },
  });

  const dataVolume = new ZfsNvmeVolume(chart, "scout-evals-data", {
    storage: Size.gibibytes(1),
  });

  deployment.addContainer(
    withCommonProps({
      name: "scout-evals",
      image: `ghcr.io/shepherdjerred/scout-evals:${versions["shepherdjerred/scout-evals"]}`,
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
      },
      ports: [{ number: 7341, name: "http" }],
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(128),
          limit: Size.mebibytes(512),
        },
      },
      startup: Probe.fromHttpGet("/health", {
        port: 7341,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 12,
      }),
      liveness: Probe.fromHttpGet("/health", {
        port: 7341,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/health", {
        port: 7341,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      volumeMounts: [
        {
          path: "/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "scout-evals-data-volume",
            dataVolume.claim,
          ),
        },
      ],
      envVariables: {
        SCOUT_EVAL_HOSTNAME: EnvValue.fromValue("0.0.0.0"),
        SCOUT_EVAL_DATABASE_PATH: EnvValue.fromValue(
          "/data/scout-review-evals.sqlite",
        ),
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "scout-evals-service", {
    metadata: {
      labels: {
        app: "scout-evals",
      },
    },
    selector: deployment,
    ports: [{ port: 7341, name: "http" }],
  });

  // Tailnet-only ingress — this IS the trust boundary (no app auth).
  new TailscaleIngress(chart, "scout-evals-ingress", {
    service,
    host: "scout-evals",
    probePath: "/health",
  });
}
