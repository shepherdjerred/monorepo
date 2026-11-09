import { z } from "zod";

// Every external input to a disposable server is pinned by digest or hash so
// a run is reproducible and a supply-chain swap fails loudly.
export const serverImage =
  "itzg/minecraft-server:2026.10.1-java25@sha256:d12aed7e35981dfe259b60fbfee77d23a19b5898a7a31dca298d18b47b7b5776";

export const paper = {
  version: "26.3",
  build: 244,
  // From https://fill.papermc.io/v3/projects/paper/versions/26.3/builds (channel STABLE).
  url: "https://fill-data.papermc.io/v1/objects/9601f9a26a2a52a0f2c807cf1abf691f96ee4fb287878313b601cebc2c51eabf/paper-26.3-244.jar",
  sha256: "9601f9a26a2a52a0f2c807cf1abf691f96ee4fb287878313b601cebc2c51eabf",
  // https://github.com/PrismarineJS/minecraft-data protocolVersions.json: 26.3 is 777.
  protocol: 777,
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
  version: "7.4.6",
  url: "https://cdn.modrinth.com/data/1u6JkXh5/versions/YFnqiUlL/worldedit-bukkit-7.4.6.jar",
  sha256: "e0ce67d870ad1fef8a40dd9d7926360caf3bb44722438545d6b20b55f82a0c91",
});

/**
 * Citizens build for Paper 26.3: MCBridge's test actors (/v1/actors) are
 * Citizens player NPCs. Matches the API the bridge compiles against
 * (citizens-main 2.0.44 in the-storm's version catalog).
 */
export const citizens: PluginPin = PluginPinSchema.parse({
  name: "Citizens",
  version: "2.0.44-b4269",
  url: "https://ci.citizensnpcs.co/job/Citizens2/4269/artifact/dist/target/Citizens-2.0.44-b4269.jar",
  sha256: "e6b0a0e3346bd2cb982bcd3e1b628143629042e1a50479ae3c24858e2cacde22",
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
 * TheStorm's paper-plugin.yml requires CoreProtect since the Citizens move;
 * same build as the production server image (server/plugins.json).
 */
export const coreProtect: PluginPin = PluginPinSchema.parse({
  name: "CoreProtect",
  version: "25.1",
  url: "https://public.sjer.red/the-storm/plugins/CoreProtect-25.1.jar",
  sha256: "89be1353b9fca3b86ce3dd93c8af78262b2be91f1b53feca8d9018c45e877e5d",
});

/**
 * The world module requires Multiverse to load before TheStorm, even when the
 * module is switched off.
 */
export const multiverseCore: PluginPin = PluginPinSchema.parse({
  name: "Multiverse-Core",
  version: "5.8.2",
  url: "https://cdn.modrinth.com/data/3wmN97b8/versions/de7TbcZG/multiverse-core-5.8.2.jar",
  sha256: "792252b6bbcf17c94ab8385e595281c830d7a40c946aea1832d8a010702bb630",
});

/** Exact 26.3 build required by TheStorm's safety module; corrections are separately gated. */
export const grim: PluginPin = PluginPinSchema.parse({
  name: "GrimAC",
  version: "2.3.75-85d931f",
  url: "https://cdn.modrinth.com/data/LJNGWSvH/versions/j42l2u1k/grimac-bukkit-2.3.75-85d931f.jar",
  sha256: "48229d32fc65882a7a4573a63fbda9b175f7537ec79eddfd89d94cfc51fdcd15",
});
