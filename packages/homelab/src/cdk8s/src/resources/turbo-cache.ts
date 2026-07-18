import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

// ducktors/turborepo-remote-cache listens on 3000 by default (PORT env).
const PORT = 3000;

// Cloudflare R2 exposes an S3-compatible endpoint at
// https://<account-id>.r2.cloudflarestorage.com. This is the same account that
// backs the Velero R2 bucket (see argo-applications/velero.ts) — the account id
// is not a secret, so it stays a plain literal; only the S3 keypair and the
// shared TURBO_TOKEN come from 1Password.
const R2_ACCOUNT_ID = "48948ed6cd40d73e34d27f0cc10e595f";
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export function createTurboCacheDeployment(chart: Chart) {
  // 1Password item `turbo-cache-r2` (Homelab (Kubernetes) vault). Fields:
  //   - S3_ACCESS_KEY / S3_SECRET_KEY: R2 S3 keypair. Reuses the account-wide
  //     "CloudFlare R2" token (operator decision 2026-07-16 — reuse over
  //     minting a bucket-scoped token; see docs/todos/turbo-cache-rollout.md)
  //   - TURBO_TOKEN: shared bearer token turbo clients present via
  //     `turbo --token` / TURBO_TOKEN to authenticate against this cache;
  //     the same value lives in the `buildkite-ci-secrets` item for CI
  // The R2 bucket itself is provisioned by tofu (src/tofu/cloudflare/turbo-cache.tf);
  // the S3 keypair cannot be minted by the tofu provider, so it is managed in the
  // R2 dashboard and stored here manually.
  const secrets = new OnePasswordItem(chart, "turbo-cache-secrets", {
    spec: {
      itemPath: vaultItemPath("turbo-cache-r2"),
    },
    metadata: {
      name: "turbo-cache-r2",
    },
  });
  const secretRef = Secret.fromSecretName(
    chart,
    "turbo-cache-secrets-ref",
    secrets.name,
  );

  const deployment = new Deployment(chart, "turbo-cache", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
  });

  deployment.addContainer(
    withCommonProps({
      name: "turbo-cache",
      image: `ducktors/turborepo-remote-cache:${versions["ducktors/turborepo-remote-cache"]}`,
      ports: [{ name: "http", number: PORT }],
      envVariables: {
        PORT: EnvValue.fromValue(String(PORT)),
        NODE_ENV: EnvValue.fromValue("production"),
        // S3-compatible backend (Cloudflare R2). Non-sensitive config is
        // inlined; STORAGE_PATH is the bucket name.
        STORAGE_PROVIDER: EnvValue.fromValue("s3"),
        STORAGE_PATH: EnvValue.fromValue("turbo-cache"),
        S3_ENDPOINT: EnvValue.fromValue(R2_ENDPOINT),
        // R2 ignores the region but the S3 client requires one; "auto" is
        // Cloudflare's documented value.
        S3_REGION: EnvValue.fromValue("auto"),
        S3_ACCESS_KEY: EnvValue.fromSecretValue({
          secret: secretRef,
          key: "S3_ACCESS_KEY",
        }),
        S3_SECRET_KEY: EnvValue.fromSecretValue({
          secret: secretRef,
          key: "S3_SECRET_KEY",
        }),
        TURBO_TOKEN: EnvValue.fromSecretValue({
          secret: secretRef,
          key: "TURBO_TOKEN",
        }),
      },
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: {
          request: Cpu.millis(100),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(256),
          limit: Size.mebibytes(512),
        },
      },
      liveness: Probe.fromTcpSocket({
        port: PORT,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(30),
      }),
      readiness: Probe.fromTcpSocket({
        port: PORT,
        initialDelaySeconds: Duration.seconds(5),
        periodSeconds: Duration.seconds(10),
      }),
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "turbo-cache-service", {
    selector: deployment,
    ports: [{ port: PORT, name: "http" }],
  });

  // Internal-only: exposed on the tailnet (like freshrss/bugsink), no public
  // Cloudflare tunnel binding — the remote cache is only reached by developer
  // machines and in-cluster CI agents on the tailnet.
  new TailscaleIngress(chart, "turbo-cache-tailscale-ingress", {
    service,
    host: "turbo-cache",
  });

  return { deployment, service, secrets };
}
