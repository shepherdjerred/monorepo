import type { Chart } from "cdk8s";
import { createModdedMinecraftApp } from "@shepherdjerred/homelab/cdk8s/src/misc/modded-minecraft.ts";

export function createMinecraftFtbskies2App(chart: Chart) {
  return createModdedMinecraftApp(chart, {
    name: "ftbskies2",
    curseForgePageUrl:
      "https://www.curseforge.com/minecraft/modpacks/ftb-skies-2",
    hostname: "ftbskies2.sjer.red",
    motd: "FTB Skies 2",
    memory: "12G",
    resourceRequests: { memory: "16Gi", cpu: "1" },
    resourceLimits: { memory: "16Gi" },
    storageGi: 32,
    whitelist: [
      "RiotShielder",
      "vietnamesechovy",
      "XiguaShuxin",
      "XiguaJerred",
    ],
  });
}
