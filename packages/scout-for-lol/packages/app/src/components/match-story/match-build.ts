import {
  getItemInfo,
  getRuneInfo,
  getRuneTreeInfo,
  summoner,
} from "@scout-for-lol/data";
import {
  reportItemCatalog,
  type ItemTier,
} from "@scout-for-lol/data/model/reports/report-query-items.ts";
import type { SetupItem } from "@scout-for-lol/design-system/domain/rows/setup-row";
import type { DetailParticipant, StoryParticipant } from "./match-model.ts";

const TIER_BY_ITEM = new Map<number, ItemTier>(
  reportItemCatalog().map(({ rawId, item }) => [rawId, item.tier] as const),
);

/** Finished items and boots: what a build is said to be made of. */
const BUILD_TIERS = new Set<ItemTier>(["legendary", "boots", "other"]);
/** What a player carries that is not part of the build. */
const CARRIED_TIERS = new Set<ItemTier>(["consumable", "trinket"]);

export function itemName(itemId: number): string {
  const item = getItemInfo(itemId);
  if (item === undefined) {
    throw new Error(`Unknown item id ${itemId.toString()}`);
  }
  return item.name;
}

function itemEntry(itemId: number): SetupItem {
  return {
    label: itemName(itemId),
    asset: { kind: "item", key: itemId },
  };
}

export type BuiltItems = {
  items: SetupItem[];
  /** The items are in the order they were bought. */
  sequence: boolean;
};

/**
 * The viewer's items. With a timeline: the finished items in purchase order,
 * those still held at the end. Without one: the final slots, which state no
 * order.
 */
export function builtItems(
  viewer: DetailParticipant,
  story: StoryParticipant | undefined,
): BuiltItems {
  const steps =
    story?.buildOrder?.filter(
      (step) => BUILD_TIERS.has(step.tier) && step.soldAtMs === null,
    ) ?? [];
  if (steps.length > 0) {
    return {
      items: steps.map((step) => itemEntry(step.itemId)),
      sequence: true,
    };
  }
  return {
    items: viewer.loadout.itemIds
      .filter((id) => {
        if (id <= 0) return false;
        const tier = TIER_BY_ITEM.get(id);
        return tier === undefined || !CARRIED_TIERS.has(tier);
      })
      .map((id) => itemEntry(id)),
    sequence: false,
  };
}

/** The keystone and the second tree; none for a record with no rune page. */
export function builtRunes(viewer: DetailParticipant): SetupItem[] {
  const { runes } = viewer.loadout;
  if (runes === null) return [];
  const keystoneId = runes.primaryRuneIds[0];
  const keystone = getRuneInfo(keystoneId);
  if (keystone === undefined) {
    throw new Error(`Unknown rune id ${keystoneId.toString()}`);
  }
  const second = getRuneTreeInfo(runes.secondaryStyleId);
  if (second === undefined) {
    throw new Error(
      `Unknown rune tree id ${runes.secondaryStyleId.toString()}`,
    );
  }
  return [
    {
      label: keystone.name,
      asset: { kind: "rune", key: keystone.icon },
      keystone: true,
    },
    {
      label: `${second.name} second`,
      asset: { kind: "rune", key: second.icon },
    },
  ];
}

export function builtSpells(viewer: DetailParticipant): SetupItem[] {
  return viewer.loadout.summonerSpellIds.map((spellId) => {
    const spell = Object.values(summoner.data).find(
      (candidate) => Number(candidate.key) === spellId,
    );
    if (spell === undefined) {
      throw new Error(`Unknown summoner spell id ${spellId.toString()}`);
    }
    return { label: spell.name, asset: { kind: "spell", key: spell.id } };
  });
}
