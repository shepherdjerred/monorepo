import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { DeploymentStrategy, EnvValue, Probe, Secret } from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Cpu } from "cdk8s-plus-31";
import { Duration, Size } from "cdk8s";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { bugsinkEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  tailscaleIngressRule,
  externalHttpsEgressRule,
  blackboxProbeIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createTasknotesDeployment(chart: Chart) {
  return new FirstPartyWebService(chart, "tasknotes-web-service", {
    name: "tasknotes",
    port: 3000,
    probes: {
      live: "/api/health",
      ready: "/api/health",
      startup: { failureThreshold: 12 },
    },
    deployment: {
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
      // The pods predate the construct and carry no `app` label.
      podMetadata: {},
    },
    // Both containers share the vault.
    data: {
      id: "tasknotes-vault-pvc",
      storage: Size.gibibytes(5),
      path: "/vault",
    },
    // The root filesystem is writable, and the sync loop keeps its heartbeat
    // in the container's own /tmp.
    tmp: false,
    containers: () => {
      const onePasswordItem = new OnePasswordItem(chart, "tasknotes-1p", {
        spec: {
          itemPath: vaultItemPath("tasknotes-server"),
        },
      });
      return {
        // Container 1: TaskNotes API Server (Hono on port 3000)
        server: {
          name: "tasknotes-server",
          image: firstPartyImageRecipe("tasknotes-server"),
          securityContext: {
            readOnlyRootFilesystem: false,
            ensureNonRoot: false,
          },
          resources: {
            cpu: {
              request: Cpu.millis(100),
              limit: Cpu.millis(500),
            },
            memory: {
              request: Size.mebibytes(64),
              limit: Size.gibibytes(1),
            },
          },
          envVariables: {
            VAULT_PATH: EnvValue.fromValue("/vault"),
            TASKS_DIR: EnvValue.fromValue("TaskNotes"),
            HOST: EnvValue.fromValue("0.0.0.0"),
            PORT: EnvValue.fromValue("3000"),
            AUTH_TOKEN: EnvValue.fromSecretValue({
              secret: Secret.fromSecretName(
                chart,
                "tasknotes-auth-token-secret",
                onePasswordItem.name,
              ),
              key: "AUTH_TOKEN",
            }),

            // Bugsink error reporting
            ...bugsinkEnv(
              Secret.fromSecretName(
                chart,
                "tasknotes-bugsink-dsn-secret",
                onePasswordItem.name,
              ),
              {
                environment: "production",
                release: firstPartyImageRecipe("tasknotes-server"),
              },
            ),
          },
        },
        sidecars: [
          // Container 2: Obsidian Headless Sync (official CLI)
          {
            name: "obsidian-headless",
            image: firstPartyImageRecipe("obsidian-headless"),
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
              [
                "sh",
                "-c",
                "find /tmp -name ob-sync-alive -mmin -5 | grep -q .",
              ],
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
          },
        ],
      };
    },
    // Only accessible via Tailscale.
    tailscale: {
      // "/" is AUTH_TOKEN-gated (401); /api/health is the unauthenticated
      // health endpoint (same one the container's k8s probes use).
      probePath: "/api/health",
      hosts: [{ id: "tasknotes-ingress", host: "tasknotes" }],
    },
    policies: [
      // Allow ingress from Tailscale (mobile app via Tailscale)
      {
        name: "tasknotes-ingress-netpol",
        selects: "namespace",
        ingress: [
          tailscaleIngressRule(),
          // Allow blackbox-exporter's in-cluster health probe (http service port
          // only — not every port on the pod)
          blackboxProbeIngressRule(3000),
        ],
      },
      // Allow egress to DNS and external HTTPS (Obsidian sync servers)
      {
        name: "tasknotes-egress-netpol",
        selects: "namespace",
        egress: [
          // DNS
          dnsEgressRule(),
          // External HTTPS (api.obsidian.md, sync-N.obsidian.md WebSocket)
          externalHttpsEgressRule(),
        ],
      },
    ],
  });
}
