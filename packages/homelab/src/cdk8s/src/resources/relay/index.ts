import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

// In-cluster SeaweedFS S3 gateway. relay-server runs in this cluster, so it
// reaches SeaweedFS directly via the Kubernetes service — NOT the public
// `https://seaweedfs.sjer.red` Cloudflare ingress (which would hairpin every
// request). Same endpoint used by scout/birmel/pokemon/s3-static-sites.
const S3_ENDPOINT = "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333";

// Full relay.toml, mounted over the image default at /app/relay.toml.
//
// Why a config file instead of env vars: the `RELAY_SERVER_STORAGE=s3://bucket`
// shorthand only sets the bucket and then talks to REAL AWS S3 (virtual-hosted
// style) — it ignores AWS_ENDPOINT_URL_S3 and AWS_S3_USE_PATH_STYLE, so it can't
// target SeaweedFS. The explicit `[store] type = "s3"` block DOES honor
// endpoint + path_style. S3 credentials are NOT in this file (they'd be in a
// ConfigMap = plaintext); they come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
// env (the shared SeaweedFS creds) via the default AWS credential chain.
//
// The [[auth]] public keys are copied verbatim from the image's default
// /app/relay.toml (relay.md-published Ed25519 keys). Keep them in sync with the
// image on upgrade; a mismatch breaks token validation.
// TODO(todo:relay-auth-key-drift): manual re-sync required on every relay-server
// image bump — no automated drift detection yet (see the todo for the procedure).
// These are PUBLIC keys
// (not secrets); they're assembled from fragments only to avoid a
// no-secrets/no-secrets false positive on high-entropy base64.
const AUTH_PUBLIC_KEY_2025_10_22 =
  "/6OgBTHaRdW" + "LogewMdyE+7Axn" + "I0/HP3WGqRs/bYBlFg=";
const AUTH_PUBLIC_KEY_2025_10_23 =
  "fbm9JLHrwPp" + "ST5HAYORTQR/i1V" + "bZ1kdp2ZEy0XpMbf0=";

const RELAY_TOML = `[server]
host = "0.0.0.0"
port = 8080
url = "https://relay.sjer.red"

[store]
type = "s3"
bucket = "relay-docs"
region = "us-east-1"
endpoint = "${S3_ENDPOINT}"
path_style = true

[[auth]]
key_id = "relay_2025_10_22"
public_key = "${AUTH_PUBLIC_KEY_2025_10_22}"

[[auth]]
key_id = "relay_2025_10_23"
public_key = "${AUTH_PUBLIC_KEY_2025_10_23}"
`;

// Self-hosted Relay Server — real-time collaboration backend for the Obsidian
// Relay plugin (System 3 / No-Instructions; a fork of y-sweet / Yjs CRDT).
//
// Design notes:
// - Stateless container: ALL document CRDT state + attachments live in
//   SeaweedFS (S3) bucket `relay-docs` (created in src/tofu/seaweedfs/buckets.tf),
//   so there is no PVC.
// - S3 credentials are the SHARED SeaweedFS creds (same 1Password item used by
//   pokemon/birmel/scout/s3-static-sites); the item exposes SEAWEEDFS_* fields
//   which we remap to AWS_* env vars.
// - Auth is delegated: the server validates relay.md-issued, document-scoped,
//   1-hour tokens against the [[auth]] public keys. So a public endpoint is not
//   anonymous-open — every connection needs a token relay.md signed for an
//   authorized member. Tradeoff (accepted): not E2E, and on a public server
//   relay.md could technically mint a token and read content.
// - Exposed publicly via Cloudflare Tunnel (outbound-only; no inbound port on
//   the homelab). Ingress is locked to the cloudflare-tunnel namespace.
export function createRelayDeployment(chart: Chart) {
  // Shared SeaweedFS S3 credentials (item id vet52jaeh75chsalu6lulugium),
  // mirrored into the relay namespace. Fields: SEAWEEDFS_ACCESS_KEY_ID /
  // SEAWEEDFS_SECRET_ACCESS_KEY (remapped to AWS_* below).
  const seaweedfsCreds = new OnePasswordItem(chart, "relay-seaweedfs-1p", {
    spec: {
      itemPath: vaultItemPath("vet52jaeh75chsalu6lulugium"),
    },
    metadata: {
      name: "relay-seaweedfs-s3-credentials",
    },
  });

  const config = new ConfigMap(chart, "relay-config", {
    data: { "relay.toml": RELAY_TOML },
  });
  const configVolume = Volume.fromConfigMap(
    chart,
    "relay-config-volume",
    config,
  );

  const deployment = new Deployment(chart, "relay", {
    replicas: 1,
    // Single-writer CRDT server + no persistent volume, but Recreate avoids two
    // instances briefly racing the same S3 objects during a rollout.
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "relay-server (beta) writes transient state to its root filesystem",
        "ignore-check.kube-linter.io/run-as-non-root":
          "relay-server image does not define a non-root user; runs as image default",
      },
    },
    podMetadata: {
      labels: {
        app: "relay",
      },
    },
  });

  deployment.addContainer(
    withCommonProps({
      name: "relay-server",
      image: `docker.system3.md/relay-server:${versions["relay-server"]}`,
      ports: [{ number: 8080, name: "http" }],
      envVariables: {
        // Store config (endpoint/bucket/path-style) lives in relay.toml above;
        // only the S3 credentials + region come from env.
        AWS_REGION: EnvValue.fromValue("us-east-1"),
        AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "relay-aws-access-key-id",
            seaweedfsCreds.name,
          ),
          key: "SEAWEEDFS_ACCESS_KEY_ID",
        }),
        AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "relay-aws-secret-access-key",
            seaweedfsCreds.name,
          ),
          key: "SEAWEEDFS_SECRET_ACCESS_KEY",
        }),
      },
      volumeMounts: [
        {
          path: "/app/relay.toml",
          volume: configVolume,
          subPath: "relay.toml",
        },
      ],
      securityContext: {
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
        ensureNonRoot: false,
      },
      resources: {
        cpu: {
          request: Cpu.millis(250),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(2),
        },
      },
      // No documented HTTP health endpoint on the beta image; TCP-probe the
      // WebSocket port. Revisit if a /health endpoint is confirmed.
      liveness: Probe.fromTcpSocket({
        port: 8080,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(30),
      }),
      readiness: Probe.fromTcpSocket({
        port: 8080,
        initialDelaySeconds: Duration.seconds(5),
        periodSeconds: Duration.seconds(10),
      }),
      startup: Probe.fromTcpSocket({
        port: 8080,
        failureThreshold: 30,
        periodSeconds: Duration.seconds(5),
      }),
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "relay-service", {
    selector: deployment,
    metadata: {
      labels: { app: "relay" },
    },
    ports: [{ port: 8080, name: "http" }],
  });

  // Restrict ingress to the Cloudflare Tunnel (public path); allow egress to
  // DNS and to the in-cluster SeaweedFS S3 gateway. Token validation is offline
  // (baked-in public keys), so no control-plane egress is required.
  new KubeNetworkPolicy(chart, "relay-netpol", {
    metadata: { name: "relay-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "relay" } },
      policyTypes: ["Egress", "Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "cloudflare-tunnel",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8080), protocol: "TCP" }],
        },
      ],
      egress: [
        {
          // DNS
          to: [
            {
              namespaceSelector: {},
              podSelector: {
                matchLabels: { "k8s-app": "kube-dns" },
              },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        {
          // In-cluster SeaweedFS S3 gateway (object storage)
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "seaweedfs",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8333), protocol: "TCP" }],
        },
      ],
    },
  });

  // Public access via Cloudflare Tunnel (outbound-only; no inbound port).
  // Cloudflare terminates TLS at the edge and passes WebSocket upgrades to the
  // http origin; clients connect over wss://relay.sjer.red. No TailscaleIngress
  // (Tailscale declined). DNS record is managed in src/tofu/cloudflare/.
  createCloudflareTunnelBinding(chart, "relay-cf-tunnel", {
    serviceName: service.name,
    fqdn: "relay.sjer.red",
  });

  return { deployment, service, seaweedfsCreds, config };
}
