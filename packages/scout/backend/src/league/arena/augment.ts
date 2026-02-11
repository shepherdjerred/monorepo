import { AugmentSchema, type Augment, type FullAugment } from "@shepherdjerred/scout-data";
import { arenaAugmentCache } from "@shepherdjerred/scout-data/data-dragon/arena-augments.ts";

// Use the local cached arena augments data.
// The cache is updated by running `bun run scripts/update-data-dragon.ts` in packages/data.
// This is consistent with how all other Data Dragon data (items, champions, runes, etc.) is handled.
function getArenaAugmentMap(): Record<number, FullAugment> {
  return arenaAugmentCache;
}

export function mapAugmentIdsToUnion(augmentIds: number[]): Augment[] {
  const map = getArenaAugmentMap();
  const result: Augment[] = [];
  for (const id of augmentIds) {
    const aug = map[id];
    const parsed = AugmentSchema.safeParse({
      ...aug,
      type: "full",
    });
    if (parsed.success) {
      result.push(parsed.data);
    } else {
      result.push({ id, type: "id" });
    }
  }
  return result;
}
