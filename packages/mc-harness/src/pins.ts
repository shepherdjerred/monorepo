import { z } from "zod";

// Every external input to a disposable server is pinned by digest or hash so
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
 * Citizens build for Paper 26.2, for the harness's test actors. Not staged
 * until the actor routes land.
 */
export const citizens: PluginPin = PluginPinSchema.parse({
  name: "Citizens",
  version: "2.0.44-b4256",
  url: "https://ci.citizensnpcs.co/job/Citizens2/4256/artifact/dist/target/Citizens-2.0.44-b4256.jar",
  sha256: "d1f02151fd7c1ccd0b8d317249ea9cf60039711b4e3317bd6641a385878946c6",
});
