import type { Chart } from "cdk8s";
import { createModdedMinecraftApp } from "@shepherdjerred/homelab/cdk8s/src/misc/modded-minecraft.ts";

export function createMinecraftAllofcreateApp(chart: Chart) {
  return createModdedMinecraftApp(chart, {
    name: "allofcreate",
    curseForgePageUrl:
      "https://www.curseforge.com/minecraft/modpacks/all-of-create",
    hostname: "allofcreate.sjer.red",
    motd: "All of Create",
    memory: "6G",
    resourceRequests: { memory: "8Gi", cpu: "1" },
    resourceLimits: { memory: "8Gi" },
    storageGi: 32,
    whitelist: ["RiotShielder", "vietnamesechovy"],
  });
}
