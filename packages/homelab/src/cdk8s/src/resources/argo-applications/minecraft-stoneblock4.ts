import type { Chart } from "cdk8s";
import { createModdedMinecraftApp } from "@shepherdjerred/homelab/cdk8s/src/misc/modded-minecraft.ts";

export function createMinecraftStoneblock4App(chart: Chart) {
  return createModdedMinecraftApp(chart, {
    name: "stoneblock4",
    curseForgePageUrl:
      "https://www.curseforge.com/minecraft/modpacks/ftb-stoneblock-4",
    hostname: "stoneblock4.sjer.red",
    motd: "FTB StoneBlock 4",
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
