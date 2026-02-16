import { z } from "zod";
import { FullAugmentSchema, type FullAugment } from "@scout-for-lol/data/model/arena/augment.ts";
import arenaAugmentsData from "./assets/arena-augments.json" with { type: "json" };

const ArenaAugmentCacheSchema = z.record(z.string(), FullAugmentSchema);

const parsedAugments = ArenaAugmentCacheSchema.parse(arenaAugmentsData);

export const arenaAugmentCache = Object.fromEntries(
  Object.entries(parsedAugments).map(([id, augment]) => [Number.parseInt(id, 10), augment]),
) satisfies Record<number, FullAugment>;

export function getCachedArenaAugmentById(id: number): FullAugment | undefined {
  return arenaAugmentCache[id];
}
