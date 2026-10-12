import {
  luckPerms,
  multiverseCore,
  PluginPinSchema,
  type PluginPin,
} from "@shepherdjerred/mc-harness/pins.ts";
import minecraftData from "minecraft-data";
import { z } from "zod";

// The pinned server image, Paper build and TheStorm's required plugins live in
// @shepherdjerred/mc-harness; this file pins only what the Mineflayer suite
// adds on top: the client version and the Via protocol bridge.

// mineflayer 4.39.0 tops out at 26.1; ViaBackwards bridges 26.2 down to it.
export const botVersion = "26.1";

// The protocol the bot speaks, read from the pinned minecraft-data so a data
// bump that changes it fails here rather than as a confusing join error.
export const botProtocol = z
  .object({ version: z.object({ version: z.number().int().positive() }) })
  .parse(minecraftData(botVersion)).version.version;

export const thirdPartyPlugins: readonly PluginPin[] = z
  .array(PluginPinSchema)
  .parse([
    {
      name: "WorldEdit",
      version: "7.4.5",
      url: "https://cdn.modrinth.com/data/1u6JkXh5/versions/F5ea2ov3/worldedit-bukkit-7.4.5.jar",
      sha256:
        "e5696a6d064b9969437a8888be91b0941148a28e0c3736de1554a00254a5d142",
    },
    {
      name: "CoreProtect",
      version: "24.1",
      url: "https://cdn.modrinth.com/data/Lu3KuzdV/versions/3sehX6Sg/CoreProtect-CE-24.1.jar",
      sha256:
        "a2acef7c06ef201355cef07d591a6055dfed358ad768faaaaaf4e276865ecc97",
    },
    {
      name: "Citizens",
      version: "2.0.44-b4256",
      url: "https://ci.citizensnpcs.co/job/Citizens2/4256/artifact/dist/target/Citizens-2.0.44-b4256.jar",
      sha256:
        "d1f02151fd7c1ccd0b8d317249ea9cf60039711b4e3317bd6641a385878946c6",
    },
    {
      name: "ViaVersion",
      version: "5.12.0",
      url: "https://cdn.modrinth.com/data/P1OZGk5p/versions/FaishMnD/ViaVersion-5.12.0.jar",
      sha256:
        "c4d512fa9760fa41d17abaedde12aa1f4c9bde920d0a992fe0fc016962f126be",
    },
    {
      name: "ViaBackwards",
      version: "5.12.0",
      url: "https://cdn.modrinth.com/data/NpvuJQoq/versions/SxGhdsPK/ViaBackwards-5.12.0.jar",
      sha256:
        "f902f7da7eb99e8bfaf461f80283c4e2750b7d9727e6b508ea4bb9163f55b1db",
    },
    // TheStorm's required plugins, shared with the mc-harness storm-dev profile.
    luckPerms,
    multiverseCore,
  ]);
