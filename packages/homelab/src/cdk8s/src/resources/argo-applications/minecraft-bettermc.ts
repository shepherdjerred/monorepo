import type { Chart } from "cdk8s";
import { createModdedMinecraftApp } from "@shepherdjerred/homelab/cdk8s/src/misc/modded-minecraft.ts";

export function createMinecraftBettermcApp(chart: Chart) {
  return createModdedMinecraftApp(chart, {
    name: "bettermc",
    curseForgePageUrl:
      "https://www.curseforge.com/minecraft/modpacks/better-mc-forge-bmc4",
    hostname: "bettermc.sjer.red",
    motd: "Better Minecraft",
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
