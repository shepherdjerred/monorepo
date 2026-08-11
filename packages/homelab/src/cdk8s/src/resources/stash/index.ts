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
  Volume,
} from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { ZfsSataVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-sata-volume.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const PORT = 9999;
const LABELS = { app: "stash" };

export const STASH_AUTH_INIT_SCRIPT = String.raw`set -eu
umask 077
printf '%s\n' "$STASH_USERNAME" | grep -Eq '^[A-Za-z0-9._-]+$'
printf '%s\n' "$STASH_PASSWORD_HASH" | grep -Eq '^[$]2[aby][$]10[$][./A-Za-z0-9]{53}$'
mkdir -p /state
if test -f /state/config.yml; then
  awk '!/^(username|password):/' /state/config.yml > /state/config.yml.next
else
  : > /state/config.yml.next
fi
printf 'username: "%s"\npassword: "%s"\n' "$STASH_USERNAME" "$STASH_PASSWORD_HASH" >> /state/config.yml.next
mv /state/config.yml.next /state/config.yml
chmod 600 /state/config.yml`;

function createDnsEgress() {
  return {
    to: [
      {
        namespaceSelector: {},
        podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
      },
    ],
    ports: [
      { port: IntOrString.fromNumber(53), protocol: "UDP" },
      { port: IntOrString.fromNumber(53), protocol: "TCP" },
    ],
  };
}

export function createStashDeployment(chart: Chart) {
  const credentialsItem = new OnePasswordItem(chart, "stash-credentials", {
    spec: {
      itemPath: vaultItemPath("yo6duoxqos4sktcs5ogj54vbdu"),
    },
  });
  const credentials = Secret.fromSecretName(
    chart,
    "stash-credentials-secret",
    credentialsItem.name,
  );

  const stateClaim = new ZfsNvmeVolume(chart, "stash-state", {
    storage: Size.gibibytes(64),
  });
  const generatedClaim = new ZfsSataVolume(chart, "stash-generated", {
    storage: Size.gibibytes(256),
  });
  const mediaClaim = new ZfsSataVolume(chart, "stash-media", {
    storage: Size.tebibytes(1),
  });

  const stateVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "stash-state-volume",
    stateClaim.claim,
  );
  const generatedVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "stash-generated-volume",
    generatedClaim.claim,
  );
  const mediaVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "stash-media-volume",
    mediaClaim.claim,
  );
  const cacheVolume = Volume.fromEmptyDir(chart, "stash-cache", "cache", {
    sizeLimit: Size.gibibytes(8),
  });
  const tmpVolume = Volume.fromEmptyDir(chart, "stash-tmp", "tmp", {
    sizeLimit: Size.gibibytes(2),
  });

  const deployment = new Deployment(chart, "stash", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    securityContext: { ensureNonRoot: false },
    metadata: {
      labels: LABELS,
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "The upstream image runs as root; privileges and filesystem writes remain constrained.",
      },
    },
    podMetadata: { labels: LABELS },
  });

  deployment.addInitContainer(
    withCommonProps({
      name: "configure-auth",
      image: `library/busybox:${versions["library/busybox"]}`,
      command: ["/bin/sh", "-c"],
      args: [STASH_AUTH_INIT_SCRIPT],
      envVariables: {
        STASH_USERNAME: EnvValue.fromSecretValue({
          secret: credentials,
          key: "username",
        }),
        STASH_PASSWORD_HASH: EnvValue.fromSecretValue({
          secret: credentials,
          key: "password_hash",
        }),
      },
      resources: {
        cpu: { request: Cpu.millis(5), limit: Cpu.millis(50) },
        memory: { request: Size.mebibytes(8), limit: Size.mebibytes(32) },
      },
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        privileged: false,
      },
      volumeMounts: [{ path: "/state", volume: stateVolume }],
    }),
  );

  deployment.addContainer(
    withCommonProps({
      name: "stash",
      image: `stashapp/stash:${versions["stashapp/stash"]}`,
      args: ["--nobrowser"],
      ports: [{ number: PORT, name: "http" }],
      startup: Probe.fromHttpGet("/healthz", {
        port: PORT,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 60,
      }),
      readiness: Probe.fromHttpGet("/healthz", {
        port: PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      liveness: Probe.fromHttpGet("/healthz", {
        port: PORT,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      resources: {
        cpu: { request: Cpu.millis(250), limit: Cpu.units(4) },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(4),
        },
      },
      envVariables: {
        STASH_CONFIG_FILE: EnvValue.fromValue("/state/config.yml"),
        STASH_STASH: EnvValue.fromValue("/data/"),
        STASH_METADATA: EnvValue.fromValue("/state/metadata/"),
        STASH_BLOBS: EnvValue.fromValue("/state/blobs/"),
        STASH_GENERATED: EnvValue.fromValue("/generated/"),
        STASH_CACHE: EnvValue.fromValue("/cache/"),
        STASH_PORT: EnvValue.fromValue(String(PORT)),
      },
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        privileged: false,
      },
      volumeMounts: [
        { path: "/state", volume: stateVolume },
        { path: "/generated", volume: generatedVolume },
        { path: "/data", volume: mediaVolume },
        { path: "/cache", volume: cacheVolume },
        { path: "/tmp", volume: tmpVolume },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "stash-service", {
    metadata: { labels: LABELS },
    selector: deployment,
    ports: [{ port: PORT, name: "http" }],
  });

  new TailscaleIngress(chart, "stash-ingress", {
    service,
    host: "stash",
    proxyClass: "medium",
    probePath: "/healthz",
  });

  new KubeNetworkPolicy(chart, "stash-network-policy", {
    metadata: { name: "stash-network-policy" },
    spec: {
      podSelector: { matchLabels: LABELS },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(PORT), protocol: "TCP" }],
        },
      ],
      egress: [
        createDnsEgress(),
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [
            { port: IntOrString.fromNumber(80), protocol: "TCP" },
            { port: IntOrString.fromNumber(443), protocol: "TCP" },
          ],
        },
      ],
    },
  });

  return { deployment, service };
}
