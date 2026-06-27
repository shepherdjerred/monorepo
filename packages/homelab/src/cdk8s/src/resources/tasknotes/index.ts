import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Cpu } from "cdk8s-plus-31";
import { Duration, Size } from "cdk8s";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";

export function createTasknotesDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "tasknotes", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: 1000,
      ensureNonRoot: false,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "TaskNotes requires flexible user permissions for file operations",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "TaskNotes requires writable filesystem for vault sync and server operations",
      },
    },
  });

  const onePasswordItem = new OnePasswordItem(chart, "tasknotes-1p", {
    spec: {
      itemPath: vaultItemPath("tasknotes-server"),
    },
  });

  const vaultVolume = new ZfsNvmeVolume(chart, "tasknotes-vault-pvc", {
    storage: Size.gibibytes(5),
  });

  const sharedVaultMount = {
    path: "/vault",
    volume: Volume.fromPersistentVolumeClaim(
      chart,
      "tasknotes-vault-volume",
      vaultVolume.claim,
    ),
  };

  // Container 1: TaskNotes API Server (Hono on port 3000)
  deployment.addContainer(
    withCommonProps({
      name: "tasknotes-server",
      image: `ghcr.io/shepherdjerred/tasknotes-server:${versions["shepherdjerred/tasknotes-server"]}`,
      securityContext: {
        readOnlyRootFilesystem: false,
        ensureNonRoot: false,
      },
      ports: [{ number: 3000, name: "http" }],
      resources: {
        cpu: {
          request: Cpu.millis(100),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(256),
          limit: Size.gibibytes(1),
        },
      },
      startup: Probe.fromHttpGet("/api/health", {
        port: 3000,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 12,
      }),
      liveness: Probe.fromHttpGet("/api/health", {
        port: 3000,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/api/health", {
        port: 3000,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      volumeMounts: [sharedVaultMount],
      envVariables: {
        VAULT_PATH: EnvValue.fromValue("/vault"),
        TASKS_DIR: EnvValue.fromValue("TaskNotes"),
        PORT: EnvValue.fromValue("3000"),
        AUTH_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "tasknotes-auth-token-secret",
            onePasswordItem.name,
          ),
          key: "AUTH_TOKEN",
        }),

        // Sentry / Bugsink error reporting
        SENTRY_ENABLED: EnvValue.fromValue("true"),
        SENTRY_DSN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "tasknotes-sentry-dsn-secret",
            onePasswordItem.name,
          ),
          key: "SENTRY_DSN",
        }),
        SENTRY_ENVIRONMENT: EnvValue.fromValue("production"),
        SENTRY_RELEASE: EnvValue.fromValue(
          versions["shepherdjerred/tasknotes-server"].split("@")[0] ??
            versions["shepherdjerred/tasknotes-server"],
        ),
      },
    }),
  );

  // Container 2: Obsidian Headless Sync (official CLI)
  deployment.addContainer(
    withCommonProps({
      name: "obsidian-headless",
      image: `ghcr.io/shepherdjerred/obsidian-headless:${versions["shepherdjerred/obsidian-headless"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        // Run ob sync --continuous in the background; a companion loop touches
        // /tmp/ob-sync-alive every 30 s while the process is alive.  When sync
        // exits (cleanly or via crash), the companion exits, we wait, then retry.
        // test -d /proc/$P checks process liveness without producing stderr output.
        'ob sync-setup --vault "$OBSIDIAN_VAULT_NAME" --password "$OBSIDIAN_VAULT_PASSWORD" --path /vault && while true; do rm -rf /vault/.obsidian/.sync.lock; ob sync --continuous --path /vault & P=$!; while test -d /proc/$P; do touch /tmp/ob-sync-alive; sleep 30; done; wait $P; echo "Sync exited, retrying in 10s..."; sleep 10; done',
      ],
      securityContext: {
        readOnlyRootFilesystem: false,
        ensureNonRoot: false,
      },
      // Wait for ob sync-setup to create /vault/.obsidian before allowing liveness checks.
      // /vault is a PVC, so this directory persists across restarts — correct for a startup gate.
      startup: Probe.fromCommand(["test", "-d", "/vault/.obsidian"], {
        periodSeconds: Duration.seconds(30),
        failureThreshold: 12, // up to 6 minutes for initial setup
      }),
      // /tmp/ob-sync-alive is written every 30 s while ob sync --continuous is running.
      // Using /tmp (not the PVC) avoids checking stale state across pod restarts.
      // Fails if the sync loop has not touched the file in the last 5 minutes.
      // Search /tmp by name so find does not error if the file is absent.
      liveness: Probe.fromCommand(
        ["sh", "-c", "find /tmp -name ob-sync-alive -mmin -5 | grep -q ."],
        {
          periodSeconds: Duration.seconds(30),
          failureThreshold: 6,
        },
      ),
      resources: {
        cpu: {
          request: Cpu.millis(100),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(128),
          limit: Size.mebibytes(512),
        },
      },
      volumeMounts: [sharedVaultMount],
      envVariables: {
        OBSIDIAN_AUTH_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "tasknotes-obsidian-token-secret",
            onePasswordItem.name,
          ),
          key: "OBSIDIAN_TOKEN",
        }),
        OBSIDIAN_VAULT_PASSWORD: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "tasknotes-obsidian-vault-password-secret",
            onePasswordItem.name,
          ),
          key: "OBSIDIAN_VAULT_PASSWORD",
        }),
        OBSIDIAN_VAULT_NAME: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "tasknotes-obsidian-vault-name-secret",
            onePasswordItem.name,
          ),
          key: "OBSIDIAN_VAULT_NAME",
        }),
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

  // Service for API server
  const apiService = new Service(chart, "tasknotes-service", {
    metadata: {
      labels: {
        app: "tasknotes",
      },
    },
    selector: deployment,
    ports: [{ port: 3000, name: "http" }],
  });

  // ServiceMonitor for Prometheus to scrape TaskNotes metrics
  createServiceMonitor(chart, {
    name: "tasknotes",
    port: "http",
    path: "/metrics",
    namespace: "tasknotes",
    matchLabels: { app: "tasknotes" },
  });

  // TailscaleIngress (only accessible via Tailscale)
  new TailscaleIngress(chart, "tasknotes-ingress", {
    service: apiService,
    host: "tasknotes",
  });
}
