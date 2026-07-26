import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Node,
  NodeLabelQuery,
  PersistentVolumeAccessMode,
  PersistentVolumeClaim,
  PersistentVolumeMode,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import {
  CI_NODE_HOSTNAME,
  ciNodeTaintedNode,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";

// ducktors/turborepo-remote-cache listens on 3000 by default (PORT env).
const PORT = 3000;
const CACHE_PVC_SIZE = Size.gibibytes(256);

export function createTurboCacheDeployment(chart: Chart) {
  // The local cache only needs the shared Turbo bearer token. Its contents are
  // derived build artifacts, so the claim is deliberately unbacked-up and
  // rebuildable after node loss.
  const secrets = new OnePasswordItem(chart, "turbo-cache-secrets", {
    spec: {
      // vaultItemPath takes the 1Password item *ID*, not its title. This is the
      // shared `buildkite-ci-secrets` item (same ID buildkite.ts references) —
      // we only need its TURBO_TOKEN field for the remote cache bearer token.
      itemPath: vaultItemPath("rzk3lawpk4yspyyu5rxlz44ssi"),
    },
    metadata: {
      name: "buildkite-ci-secrets",
    },
  });
  const secretRef = Secret.fromSecretName(
    chart,
    "turbo-cache-secrets-ref",
    secrets.name,
  );

  const cache = new PersistentVolumeClaim(chart, "turbo-cache-liskov", {
    storageClassName: NVME_STORAGE_CLASS_LZ4,
    accessModes: [PersistentVolumeAccessMode.READ_WRITE_ONCE],
    volumeMode: PersistentVolumeMode.FILE_SYSTEM,
    storage: CACHE_PVC_SIZE,
    metadata: {
      name: "turbo-cache-liskov",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
  });

  const deployment = new Deployment(chart, "turbo-cache", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
  });
  deployment.scheduling.attract(
    Node.labeled(NodeLabelQuery.is("kubernetes.io/hostname", CI_NODE_HOSTNAME)),
  );
  deployment.scheduling.tolerate(ciNodeTaintedNode());

  deployment.addContainer(
    withCommonProps({
      name: "turbo-cache",
      image: `ducktors/turborepo-remote-cache:${versions["ducktors/turborepo-remote-cache"]}`,
      ports: [{ name: "http", number: PORT }],
      envVariables: {
        PORT: EnvValue.fromValue(String(PORT)),
        NODE_ENV: EnvValue.fromValue("production"),
        // The cache server calls its persistent filesystem backend `local`.
        // Disable its default `/tmp` prefix so the PVC, rather than the
        // container root filesystem, owns every artifact.
        STORAGE_PROVIDER: EnvValue.fromValue("local"),
        STORAGE_PATH: EnvValue.fromValue("/cache"),
        STORAGE_PATH_USE_TMP_FOLDER: EnvValue.fromValue("false"),
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
      volumeMounts: [
        {
          path: "/cache",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "turbo-cache-volume",
            cache,
          ),
        },
      ],
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
    // "/" has no route (404); /v8/artifacts/status answers 200 without a
    // token (verified live 2026-07-24).
    probePath: "/v8/artifacts/status",
  });

  return { deployment, service, secrets, cache };
}
