import {
  buildOrderFor,
  type BuildEvent,
} from "#src/trpc/router/consumer/match-story-builds.ts";

/** A core build is three finished items: their item ids, in purchase order. */
export type CoreBuild = readonly [number, number, number];

const CORE_BUILD_ITEMS = 3;

/**
 * The first three finished items a player bought and kept, in the order they
 * bought them, or `null` when the game has fewer.
 *
 * It is the Match page's build order (`buildOrderFor`), narrowed to
 * `legendary` items that were never sold: components, boots, starters,
 * consumables and the trinket are not part of a core build, and an item sold
 * mid-game was not core.
 */
export function coreBuildOf(events: readonly BuildEvent[]): CoreBuild | null {
  const core = buildOrderFor(events)
    .filter((step) => step.tier === "legendary" && step.soldAtMs === null)
    .slice(0, CORE_BUILD_ITEMS)
    .map((step) => step.itemId);
  const [first, second, third] = core;
  return first === undefined || second === undefined || third === undefined
    ? null
    : [first, second, third];
}
