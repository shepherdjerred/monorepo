import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EmptyDirMedium,
  EnvValue,
  Probe,
  Protocol,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

const PINCHTAB_PORT = 9867;

export function createPinchtabDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "pinchtab", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      // The pinchtab image runs Chrome as its own non-root user. fsGroup lets
      // that user (whatever its UID) write to the persisted /data PVC.
      fsGroup: 1000,
      ensureNonRoot: false,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "pinchtab manages its own non-root user and runs Chrome with --no-sandbox in-container",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Chrome requires a writable filesystem for its user-data and cache directories",
      },
    },
  });

  // Shared "PinchTab" 1Password item (also synced into the birmel namespace).
  // Single source of truth for the bearer token used by both pinchtab and birmel.
  const onePasswordItem = new OnePasswordItem(chart, "pinchtab-1p", {
    spec: {
      itemPath: vaultItemPath("t2dgtdx47yd2gegad6zeelzylu"),
    },
    metadata: {
      name: "pinchtab-token",
    },
  });

  // Persistent browser profiles, server state, and managed config.
  const dataVolume = new ZfsNvmeVolume(chart, "pinchtab-data", {
    storage: Size.gibibytes(10),
  });

  // PinchTab config. The bearer token is intentionally NOT stored here — it is
  // supplied via the PINCHTAB_TOKEN env var (from 1Password), which overrides
  // the config-file value. bind 0.0.0.0 is required so the Service can reach the
  // process; headless mode is required because there is no display in-cluster.
  const config = new ConfigMap(chart, "pinchtab-config", {
    metadata: {
      name: "pinchtab-config",
    },
    data: {
      "config.json": JSON.stringify(
        {
          server: {
            bind: "0.0.0.0",
            port: String(PINCHTAB_PORT),
            stateDir: "/data/state",
          },
          profiles: {
            baseDir: "/data/profiles",
            defaultProfile: "default",
          },
          instanceDefaults: {
            mode: "headless",
            noRestore: true,
          },
        },
        null,
        2,
      ),
    },
  });

  deployment.addContainer(
    withCommonProps({
      image: `pinchtab/pinchtab:${versions["pinchtab/pinchtab"]}`,
      securityContext: {
        ensureNonRoot: false,
        // Chrome writes user-data/cache under $HOME; keep the root FS writable.
        // Can be hardened to readOnlyRootFilesystem with extra writable mounts
        // later if desired.
        readOnlyRootFilesystem: false,
        allowPrivilegeEscalation: false,
      },
      ports: [{ number: PINCHTAB_PORT, name: "http", protocol: Protocol.TCP }],
      resources: {
        cpu: {
          request: Cpu.millis(250),
          limit: Cpu.millis(2000),
        },
        memory: {
          // Limit must comfortably exceed the 2Gi Memory-backed /dev/shm below
          // plus Chrome's working set.
          request: Size.gibibytes(1),
          limit: Size.gibibytes(4),
        },
      },
      envVariables: {
        PINCHTAB_CONFIG: EnvValue.fromValue("/config/config.json"),
        PINCHTAB_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "pinchtab-token-secret",
            onePasswordItem.name,
          ),
          key: "PINCHTAB_TOKEN",
        }),
      },
      // Two-stage readiness: the dashboard answers /health quickly, but Chrome
      // takes a few seconds to initialize. The generous startup probe covers
      // that warm-up before liveness/readiness take over.
      startup: Probe.fromHttpGet("/health", {
        port: PINCHTAB_PORT,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 24,
      }),
      liveness: Probe.fromHttpGet("/health", {
        port: PINCHTAB_PORT,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/health", {
        port: PINCHTAB_PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      volumeMounts: [
        {
          path: "/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "pinchtab-data-volume",
            dataVolume.claim,
          ),
        },
        {
          path: "/config",
          volume: Volume.fromConfigMap(chart, "pinchtab-config-volume", config),
        },
        {
          // Chrome needs far more shared memory than the container default 64Mi.
          path: "/dev/shm",
          volume: Volume.fromEmptyDir(chart, "pinchtab-shm", "shm", {
            medium: EmptyDirMedium.MEMORY,
            sizeLimit: Size.gibibytes(2),
          }),
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  // Service name + namespace must resolve to pinchtab.pinchtab.svc.cluster.local,
  // which is the PINCHTAB_BASE_URL birmel already points at.
  const service = new Service(chart, "pinchtab-service", {
    metadata: {
      name: "pinchtab",
    },
    selector: deployment,
    ports: [{ port: PINCHTAB_PORT, targetPort: PINCHTAB_PORT }],
  });

  // Tailnet access to the dashboard/API for debugging and profile login flows.
  new TailscaleIngress(chart, "pinchtab-tailscale-ingress", {
    service,
    host: "pinchtab",
  });

  return service;
}
