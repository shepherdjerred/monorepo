import {
  luckPerms,
  grim,
  multiverseCore,
  PluginPinSchema,
  type PluginPin,
} from "@shepherdjerred/mc-harness/pins.ts";
import minecraftData from "minecraft-data";
import { z } from "zod";

// The pinned server image, Paper build and TheStorm's required plugins live in
// @shepherdjerred/mc-harness; this file pins only what the Mineflayer suite
// adds on top: the client version and the Via protocol bridge.

// mineflayer 4.39.0 tops out at 26.1; ViaBackwards bridges 26.3 down to it.
export const botVersion = "26.1";

// The protocol the bot speaks, read from the pinned minecraft-data so a data
// bump that changes it fails here rather than as a confusing join error.
export const botProtocol = z
  .object({ version: z.object({ version: z.number().int().positive() }) })
  .parse(minecraftData(botVersion)).version.version;

export const thirdPartyPlugins: readonly PluginPin[] = z
  .array(PluginPinSchema)
  .parse([
    grim,
    {
      name: "WorldEdit",
      version: "7.4.6",
      url: "https://cdn.modrinth.com/data/1u6JkXh5/versions/YFnqiUlL/worldedit-bukkit-7.4.6.jar",
      sha256:
        "e0ce67d870ad1fef8a40dd9d7926360caf3bb44722438545d6b20b55f82a0c91",
    },
    {
      name: "CoreProtect",
      version: "25.1",
      url: "https://public.sjer.red/the-storm/plugins/CoreProtect-25.1.jar",
      sha256:
        "89be1353b9fca3b86ce3dd93c8af78262b2be91f1b53feca8d9018c45e877e5d",
    },
    {
      name: "Citizens",
      version: "2.0.44-b4269",
      url: "https://ci.citizensnpcs.co/job/Citizens2/4269/artifact/dist/target/Citizens-2.0.44-b4269.jar",
      sha256:
        "e6b0a0e3346bd2cb982bcd3e1b628143629042e1a50479ae3c24858e2cacde22",
    },
    {
      name: "ViaVersion",
      version: "5.12.3",
      url: "https://cdn.modrinth.com/data/P1OZGk5p/versions/MBRBVfoZ/ViaVersion-5.12.3.jar",
      sha256:
        "8dec6b62c7ec4f355e59175fc8eaeb825719ae8d308723617097dcaab7073531",
    },
    {
      name: "ViaBackwards",
      version: "5.12.3",
      url: "https://cdn.modrinth.com/data/NpvuJQoq/versions/Z5xofDU6/ViaBackwards-5.12.3.jar",
      sha256:
        "81a1ef49567f76ba4ad43f7489080bc580e3fcf3d9601b7e852820ed4b6cecc7",
    },
    // TheStorm's required plugins, shared with the mc-harness storm-dev profile.
    luckPerms,
    multiverseCore,
  ]);
