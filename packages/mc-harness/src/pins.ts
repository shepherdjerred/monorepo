import rawCatalog from "@shepherdjerred/version-catalog/catalog.json";
import {
  parseVersionCatalog,
  versionCatalogMap,
} from "@shepherdjerred/version-catalog";
import { z } from "zod";

// Every external input to a disposable server is pinned by digest or hash so
// a run is reproducible and a supply-chain swap fails loudly.
export const serverImage =
  "itzg/minecraft-server:2026.9.1-java25@sha256:e8640538dac5d54c2838d57fa9641e735ad0cf2b71fb0e8a68da3b542a315749";

const catalog = versionCatalogMap(parseVersionCatalog(rawCatalog));

function catalogImage(repository: string, entry: string): string {
  const value = catalog[entry];
  if (value?.includes("@sha256:") !== true) {
    throw new Error(`Version catalog entry ${entry} must be a digest pin`);
  }
  return `${repository}:${value}`;
}

/**
 * The published minecraft-tsmc image at the pins the homelab deploys:
 * `prod` is what live runs, `candidate` the latest CI build. Both come from
 * the version catalog, so sandboxes and the cluster admission allowlist agree.
 */
export const stormServerImages = {
  prod: catalogImage(
    "ghcr.io/shepherdjerred/the-storm-server",
    "shepherdjerred/the-storm-server/prod",
  ),
  candidate: catalogImage(
    "ghcr.io/shepherdjerred/the-storm-server",
    "shepherdjerred/the-storm-server",
  ),
} as const;

export const paper = {
  version: "26.2",
  build: 129,
  // From https://fill.papermc.io/v3/projects/paper/versions/26.2/builds (channel STABLE).
  url: "https://fill-data.papermc.io/v1/objects/b1d8f6bfa1b6101fa8e947b53041cb3bdf5540e7b83b6547ca19ba7edefeb083/paper-26.2-129.jar",
  sha256: "b1d8f6bfa1b6101fa8e947b53041cb3bdf5540e7b83b6547ca19ba7edefeb083",
  // Server protocol reported by ViaVersion on boot: "detected server version: 26.2 (776)".
  protocol: 776,
} as const;

export const PluginPinSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  url: z.url(),
  sha256: z.string().regex(/^[\da-f]{64}$/u),
});
export type PluginPin = z.infer<typeof PluginPinSchema>;

/** Same build the production the-storm-server image ships (server/plugins.json). */
export const worldEdit: PluginPin = PluginPinSchema.parse({
  name: "WorldEdit",
  version: "7.4.5",
  url: "https://cdn.modrinth.com/data/1u6JkXh5/versions/F5ea2ov3/worldedit-bukkit-7.4.5.jar",
  sha256: "e5696a6d064b9969437a8888be91b0941148a28e0c3736de1554a00254a5d142",
});

/**
 * Citizens build for Paper 26.2: MCBridge's test actors (/v1/actors) are
 * Citizens player NPCs. Matches the API the bridge compiles against
 * (citizens-main 2.0.44 in the-storm's version catalog).
 */
export const citizens: PluginPin = PluginPinSchema.parse({
  name: "Citizens",
  version: "2.0.44-b4256",
  url: "https://ci.citizensnpcs.co/job/Citizens2/4256/artifact/dist/target/Citizens-2.0.44-b4256.jar",
  sha256: "d1f02151fd7c1ccd0b8d317249ea9cf60039711b4e3317bd6641a385878946c6",
});

/**
 * TheStorm's paper-plugin.yml requires LuckPerms (load BEFORE); same build as
 * the production server image. Staged by the `storm-dev` profile and the-storm e2e.
 */
export const luckPerms: PluginPin = PluginPinSchema.parse({
  name: "LuckPerms",
  version: "5.5.71",
  url: "https://cdn.modrinth.com/data/Vebnzrzj/versions/b0mk8uS6/LuckPerms-Bukkit-5.5.71.jar",
  sha256: "49cecb66fa1fd22a133039a490e9c1e5095a238e7cd66eb9d2a16fe6c897550d",
});

/**
 * The world module requires Multiverse to load before TheStorm, even when the
 * module is switched off.
 */
export const multiverseCore: PluginPin = PluginPinSchema.parse({
  name: "Multiverse-Core",
  version: "5.8.0",
  url: "https://cdn.modrinth.com/data/3wmN97b8/versions/bzFXz39N/multiverse-core-5.8.0.jar",
  sha256: "c527d9e21a25a71cb2442ac1f1bfd3a8a1efb7d89e0cb0e6a94f600304fde6c1",
});
