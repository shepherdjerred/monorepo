import minecraftData from "minecraft-data";
import { z } from "zod";

// Every external input to the disposable server is pinned by digest or hash so
// a run is reproducible and a supply-chain swap fails loudly.
export const serverImage =
  "itzg/minecraft-server:2026.9.1-java25@sha256:e8640538dac5d54c2838d57fa9641e735ad0cf2b71fb0e8a68da3b542a315749";

export const paper = {
  version: "26.2",
  build: 129,
  // From https://fill.papermc.io/v3/projects/paper/versions/26.2/builds (channel STABLE).
  url: "https://fill-data.papermc.io/v1/objects/b1d8f6bfa1b6101fa8e947b53041cb3bdf5540e7b83b6547ca19ba7edefeb083/paper-26.2-129.jar",
  sha256: "b1d8f6bfa1b6101fa8e947b53041cb3bdf5540e7b83b6547ca19ba7edefeb083",
  // Server protocol reported by ViaVersion on boot: "detected server version: 26.2 (776)".
  protocol: 776,
} as const;

// mineflayer 4.39.0 tops out at 26.1; ViaBackwards bridges 26.2 down to it.
export const botVersion = "26.1";

// The protocol the bot speaks, read from the pinned minecraft-data so a data
// bump that changes it fails here rather than as a confusing join error.
export const botProtocol = z
  .object({ version: z.object({ version: z.number().int().positive() }) })
  .parse(minecraftData(botVersion)).version.version;

const PluginPinSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  url: z.url(),
  sha256: z.string().regex(/^[\da-f]{64}$/u),
});
export type PluginPin = z.infer<typeof PluginPinSchema>;

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
  ]);
