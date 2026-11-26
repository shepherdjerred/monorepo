import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { tailnetService } from "homelab/src/platform-model.ts";
import {
  Cpu,
  DeploymentStrategy,
  EnvValue,
  SeccompProfileType,
  Secret,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { bugsinkEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  tailscaleIngressRule,
  externalHttpsEgressRule,
  blackboxProbeIngressRule,
  postgresEgress,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

function buildPgUrl(): string {
  const protocol = "postgres";
  const userRef = "$(DB_USER)";
  const passRef = "$(DB_" + "PASSWORD)";
  const host = "tasknotes-postgresql:5432";
  const db = "tasknotes_db";
  return `${protocol}://${userRef}:${passRef}@${host}/${db}`;
}

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
            "TaskNotes requires writable filesystem for server operations",
        },
      },
    },
    // The root filesystem is writable
    tmp: false,
    containers: () => {
      const onePasswordItem = new OnePasswordItem(chart, "tasknotes-1p", {
        spec: {
          itemPath: vaultItemPath("tasknotes-server"),
        },
      });

      const postgresSecretName =
        "tasknotes.tasknotes-postgresql.credentials.postgresql.acid.zalan.do";
      const pgSecretRef = Secret.fromSecretName(
        chart,
        "tasknotes-pg-secret-ref",
        postgresSecretName,
      );

      const dbEnv = {
        DB_USER: EnvValue.fromSecretValue({
          secret: pgSecretRef,
          key: "username",
        }),
        DB_PASSWORD: EnvValue.fromSecretValue({
          secret: pgSecretRef,
          key: "password",
        }),
        DATABASE_URL: EnvValue.fromValue(buildPgUrl()),
      };

      return {
        init: [
          {
            name: "prisma-migrate",
            image: firstPartyImageRecipe("tasknotes-server"),
            workingDir: "/app/packages/tasknotes-server",
            command: ["bun", "scripts/migrate.ts"],
            securityContext: {
              readOnlyRootFilesystem: false,
              ensureNonRoot: false,
              seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
            },
            resources: {
              cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
              memory: {
                request: Size.mebibytes(64),
                limit: Size.mebibytes(256),
              },
            },
            envVariables: {
              ...dbEnv,
              HOME: EnvValue.fromValue("/tmp"),
            },
          },
        ],
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
            ...dbEnv,
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
      };
    },
    // Only accessible via Tailscale.
    tailscale: {
      // "/" is the web app and is not token-gated. /api/* requires the bearer
      // token except /api/health, the unauthenticated probe.
      probePath: "/api/health",
      hosts: [{ id: "tasknotes-ingress", host: tailnetService("tasknotes") }],
    },
    // Both policies select the app pods alone. The Spilo pod of
    // tasknotes-postgresql stays unselected, like the other single-app
    // clusters: Patroni holds its leader lease through the Kubernetes API,
    // which an Egress policy written for the app would cut off.
    policies: [
      // Allow ingress from Tailscale (mobile app via Tailscale)
      {
        name: "tasknotes-ingress-netpol",
        selects: "app",
        ingress: [
          tailscaleIngressRule(),
          // Allow blackbox-exporter's in-cluster health probe (http service port
          // only — not every port on the pod)
          blackboxProbeIngressRule(3000),
        ],
      },
      // Allow egress to DNS, external HTTPS, and PostgreSQL
      {
        name: "tasknotes-egress-netpol",
        selects: "app",
        egress: [
          // DNS
          dnsEgressRule(),
          // External HTTPS
          externalHttpsEgressRule(),
          // PostgreSQL
          postgresEgress("tasknotes-postgresql"),
        ],
      },
    ],
  });
}
