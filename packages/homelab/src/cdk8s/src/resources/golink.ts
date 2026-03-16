import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { setRevisionHistoryLimit, withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

export function createGolinkDeployment(chart: Chart) {
  const UID = 65_532;
  const GID = 65_532;

  const deployment = new Deployment(chart, "golink", {
    replicas: 1,
    securityContext: {
      fsGroup: GID,
    },
    strategy: DeploymentStrategy.recreate(),
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "golink-pvc", {
    storage: Size.gibibytes(8),
  });

  const item = new OnePasswordItem(chart, "tailscale-auth-key-onepassword", {
    spec: {
      itemPath: vaultItemPath("mboftvs4fyptyqvg3anrfjy6vu"),
    },
    metadata: {
      name: "tailscale-auth-key",
    },
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/golink:${versions["shepherdjerred/golink"]}`,
      envVariables: {
        TS_AUTH_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "tailscale-auth-key", item.name),
          key: "client_secret",
        }),
        TS_ADVERTISE_TAGS: EnvValue.fromValue("tag:k8s-operator"),
      },
      securityContext: {
        user: UID,
        group: GID,
      },
      volumeMounts: [
        {
          path: "/home/nonroot",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "golink-volume",
            localPathVolume.claim,
          ),
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);
}
