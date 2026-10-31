import type { z } from "zod";
import type { CaptureFeatureSchema, MapSourceSchema } from "#protocol/ipc.ts";

type Feature = z.infer<typeof CaptureFeatureSchema>;

/** Vanilla worlds and plugin-owned generators load through their existing owners. */
export function importedNormalWorlds(
  source: z.infer<typeof MapSourceSchema>,
): string[] {
  const owned = new Set([
    "minecraft:overworld",
    "minecraft:the_nether",
    "minecraft:the_end",
    "minecraft:creative",
    "minecraft:skylands",
  ]);
  return (source.dimensions ?? [])
    .filter(
      (dimension) =>
        dimension.startsWith("minecraft:") && !owned.has(dimension),
    )
    .map((dimension) => dimension.slice("minecraft:".length));
}
const modules: Record<Feature, readonly string[]> = {
  stargates: ["creative", "stargates"],
  quests: ["mobs", "npcs", "quests"],
  shards: ["shards"],
  arena: ["arena"],
  rwf: ["rwf"],
  advancements: [
    "mobs",
    "npcs",
    "quests",
    "shards",
    "arena",
    "rwf",
    "advancements",
  ],
};

/** Gameplay services only; external chat, bots, and AI providers remain omitted. */
export function captureModules(
  features: readonly Feature[] | undefined,
  source: z.infer<typeof MapSourceSchema>,
): string[] {
  const selected = [
    ...new Set((features ?? []).flatMap((feature) => modules[feature])),
  ];
  if (
    selected.includes("rwf") &&
    source.dimensions?.includes("minecraft:rwf") !== true
  )
    throw new Error(
      "RWF capture requires imported real terrain for minecraft:rwf",
    );
  if (
    selected.includes("creative") &&
    source.dimensions?.includes("minecraft:creative") !== true
  )
    throw new Error(
      "Stargate capture requires the imported minecraft:creative world for its destination service",
    );
  return selected;
}
