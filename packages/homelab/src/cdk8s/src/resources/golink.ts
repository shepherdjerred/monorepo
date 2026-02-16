import { Deployment, DeploymentStrategy, EnvValue, Secret, Volume } from "cdk8s-plus-31";
import { Chart, Size } from "cdk8s";
import { withCommonProps } from "../misc/common.ts";
import { ZfsNvmeVolume } from "../misc/zfs-nvme-volume.ts";
import { OnePasswordItem } from "../../generated/imports/onepassword.com.ts";
import versions from "../versions.ts";

export function createGolinkDeployment(chart: Chart) {
  const UID = 65532;
  const GID = 65532;

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
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/t5scpnlhnxvu25dneg6jdd7c7q",
    },
    metadata: {
      name: "tailscale-auth-key",
    },
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/tailscale/golink:${versions["tailscale/golink"]}`,
      envVariables: {
        TS_AUTH_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "tailscale-auth-key", item.name),
          key: "credential",
        }),
      },
      securityContext: {
        user: UID,
        group: GID,
      },
      volumeMounts: [
        {
          path: "/home/nonroot",
          volume: Volume.fromPersistentVolumeClaim(chart, "golink-volume", localPathVolume.claim),
        },
      ],
    }),
  );
}
