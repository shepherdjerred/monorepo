import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Protocol,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createEufySecurityWsDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "eufy-security-ws", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "bropat/eufy-security-ws image runs as root",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "eufy-security-ws writes runtime state to /data and logs to stdout with buffered FS usage",
      },
    },
    podMetadata: {
      labels: { app: "eufy-security-ws" },
    },
  });

  // 1Password item holding Eufy account credentials.
  // Fields required on the item: `username`, `password`.
  const credsItem = new OnePasswordItem(chart, "eufy-security-ws-creds", {
    spec: {
      itemPath: vaultItemPath("2hqoycz2qbpsgqmgvduzsxenzi"),
    },
  });

  const credsSecret = Secret.fromSecretName(
    chart,
    "eufy-security-ws-creds-secret",
    credsItem.name,
  );

  const claim = new ZfsNvmeVolume(chart, "eufy-security-ws-pvc", {
    storage: Size.gibibytes(1),
  });

  const dataVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "eufy-security-ws-data",
    claim.claim,
  );

  deployment.addContainer(
    withCommonProps({
      image: `docker.io/bropat/eufy-security-ws:${versions["bropat/eufy-security-ws"]}`,
      ports: [
        {
          name: "ws",
          number: 3000,
          protocol: Protocol.TCP,
        },
      ],
      envVariables: {
        USERNAME: EnvValue.fromSecretValue({
          secret: credsSecret,
          key: "username",
        }),
        PASSWORD: EnvValue.fromSecretValue({
          secret: credsSecret,
          key: "password",
        }),
        COUNTRY: EnvValue.fromValue("US"),
        TRUSTED_DEVICE_NAME: EnvValue.fromValue("home-assistant"),
      },
      volumeMounts: [
        {
          path: "/data",
          volume: dataVolume,
        },
      ],
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
        privileged: false,
        allowPrivilegeEscalation: false,
      },
      startup: Probe.fromTcpSocket({
        port: 3000,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 24,
      }),
      liveness: Probe.fromTcpSocket({
        port: 3000,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
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
    }),
  );

  setRevisionHistoryLimit(deployment);

  new Service(chart, "eufy-security-ws-service", {
    metadata: {
      name: "eufy-security-ws",
      labels: { app: "eufy-security-ws" },
    },
    selector: deployment,
    ports: [{ name: "ws", port: 3000 }],
  });
}
