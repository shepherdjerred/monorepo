import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

type MinecraftServerValues = NonNullable<
  HelmValuesForChart<"minecraft">["minecraftServer"]
>;
type MinecraftPort = NonNullable<MinecraftServerValues["extraPorts"]>[number];

export function getMinecraftBlueMapPort(): MinecraftPort {
  return {
    service: { enabled: true, port: 8100 },
    protocol: "TCP",
    containerPort: 8100,
    name: "bluemap",
    ingress: { enabled: false },
  };
}
