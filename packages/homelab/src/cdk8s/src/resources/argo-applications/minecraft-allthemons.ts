import type { Chart } from "cdk8s";
import { createModdedMinecraftApp } from "@shepherdjerred/homelab/cdk8s/src/misc/modded-minecraft.ts";

export function createMinecraftAllthemonsApp(chart: Chart) {
  return createModdedMinecraftApp(chart, {
    name: "allthemons",
    curseForgePageUrl:
      "https://www.curseforge.com/minecraft/modpacks/all-the-mons",
    hostname: "allthemons.sjer.red",
    motd: "All the Mons (ATM10 + Cobblemon)",
    memory: "8G",
    resourceRequests: { memory: "10Gi", cpu: "1" },
    resourceLimits: { memory: "10Gi" },
    storageGi: 64,
    whitelist: ["RiotShielder", "vietnamesechovy", "XiguaShuxin", "XiguaJerred"],
  });
}
