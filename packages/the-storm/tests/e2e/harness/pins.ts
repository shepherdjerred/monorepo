import {
  PluginPinSchema,
  type PluginPin,
} from "@shepherdjerred/mc-harness/pins.ts";
import minecraftData from "minecraft-data";
import { z } from "zod";

// The pinned server image and Paper build live in @shepherdjerred/mc-harness;
// this file pins only what the Storm suite adds on top: the Mineflayer client
// version and the plugins TheStorm requires.

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
    {
      // TheStorm's paper-plugin.yml requires LuckPerms (load BEFORE); same
      // build as the production server image.
      name: "LuckPerms",
      version: "5.5.71",
      url: "https://cdn.modrinth.com/data/Vebnzrzj/versions/b0mk8uS6/LuckPerms-Bukkit-5.5.71.jar",
      sha256:
        "49cecb66fa1fd22a133039a490e9c1e5095a238e7cd66eb9d2a16fe6c897550d",
    },
    {
      // The world module requires Multiverse to load before TheStorm, even
      // when the smoke config switches all gameplay modules off.
      name: "Multiverse-Core",
      version: "5.8.0",
      url: "https://cdn.modrinth.com/data/3wmN97b8/versions/bzFXz39N/multiverse-core-5.8.0.jar",
      sha256:
        "c527d9e21a25a71cb2442ac1f1bfd3a8a1efb7d89e0cb0e6a94f600304fde6c1",
    },
  ]);
