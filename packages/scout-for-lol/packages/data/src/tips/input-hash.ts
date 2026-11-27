import type { ChampionId } from "#src/model/core/identifiers.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import {
  type ChampionGrounding,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import type {
  GeneralTipSet,
  MatchupTipSet,
  WikiRevisions,
} from "#src/tips/schema.ts";

/**
 * A generation unit. A matchup unit is the unordered pair: one model call
 * writes both directions, so both sets carry the same hash.
 */
export type TipUnit =
  | {
      kind: "matchup";
      lane: Lane;
      championIds: readonly [ChampionId, ChampionId];
    }
  | { kind: "general"; lane: Lane; championIds: readonly [ChampionId] };

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** JSON with object keys sorted at every depth, so equal facts hash equally. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return `[${items.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The grounding the generator writes sets from today; see `groundingVersion` in the schema. */
export const CURRENT_GROUNDING_VERSION = 2;

function projectChampion(
  grounding: ChampionGrounding,
  groundingVersion: number,
): JsonValue {
  const abilities: Record<string, JsonValue> = {};
  for (const [slot, ability] of Object.entries(grounding.facts.abilities)) {
    abilities[slot] = {
      name: ability.name,
      maxRank: ability.maxRank,
      cooldownByRank: ability.cooldownByRank,
      costByRank: ability.costByRank,
      costType: ability.costType,
      rangeByRank: ability.rangeByRank,
      dataValues: ability.dataValues,
      resolvedDescription: ability.resolvedDescription,
      ...(groundingVersion >= 2 && ability.mechanics !== undefined
        ? { mechanics: ability.mechanics }
        : {}),
    };
  }
  return {
    championId: grounding.championId,
    key: grounding.key,
    name: grounding.name,
    tags: grounding.tags,
    allytips: grounding.allytips,
    enemytips: grounding.enemytips,
    abilities,
    ...(groundingVersion >= 2
      ? {
          recentChanges: grounding.recentChanges.map((line) => ({
            patch: line.patch,
            ability: line.ability,
            stat: line.stat,
            before: line.before,
            after: line.after,
          })),
        }
      : {}),
  };
}

/**
 * The stable projection of everything a unit's prompt is grounded in. Champions
 * are ordered by id so either direction of a pair projects identically.
 */
export function projectTipUnit(
  unit: TipUnit,
  groundings: readonly ChampionGrounding[],
  wiki: WikiRevisions = {},
  groundingVersion = 1,
): JsonValue {
  const byId = new Map(
    groundings.map((grounding) => [grounding.championId, grounding]),
  );
  const champions = unit.championIds
    .toSorted((left, right) => left - right)
    .map((championId) => {
      const grounding = byId.get(championId);
      if (grounding === undefined) {
        throw new Error(
          `no grounding supplied for champion ${championId.toString()}`,
        );
      }
      return projectChampion(grounding, groundingVersion);
    });
  // Wiki revisions only join the projection when a unit used the wiki, so sets
  // written before the wiki existed keep their hashes.
  return Object.keys(wiki).length === 0
    ? { kind: unit.kind, lane: unit.lane, champions }
    : { kind: unit.kind, lane: unit.lane, champions, wiki };
}

/** SHA-256 (hex) of the prompt version and the unit's grounding projection. */
/** What a unit's hash covers beyond the prompt version and the committed facts. */
export type TipHashExtras = {
  /** The wiki pages the unit used, page title to revision id. */
  wiki?: WikiRevisions | undefined;
  /** The grounding's version; absent is 1. */
  groundingVersion?: number | undefined;
};

export function computeTipInputHash(
  promptVersion: string,
  unit: TipUnit,
  groundings: readonly ChampionGrounding[],
  extras: TipHashExtras = {},
): string {
  return new Bun.CryptoHasher("sha256")
    .update(promptVersion)
    .update("\n")
    .update(
      stableStringify(
        projectTipUnit(
          unit,
          groundings,
          extras.wiki ?? {},
          extras.groundingVersion ?? 1,
        ),
      ),
    )
    .digest("hex");
}

export function tipSetUnit(set: MatchupTipSet | GeneralTipSet): TipUnit {
  return "opponent" in set
    ? {
        kind: "matchup",
        lane: set.lane,
        championIds: [set.champion, set.opponent],
      }
    : { kind: "general", lane: set.lane, championIds: [set.champion] };
}

/**
 * A stored set is stale when the facts it was written from have changed since:
 * its hash no longer matches the hash of its own prompt version over the
 * current facts.
 */
export function isTipSetStale(
  set: MatchupTipSet | GeneralTipSet,
  groundings: readonly ChampionGrounding[],
): boolean {
  return (
    computeTipInputHash(set.promptVersion, tipSetUnit(set), groundings, {
      wiki: set.wiki,
      groundingVersion: set.groundingVersion,
    }) !== set.inputHash
  );
}

/** {@link isTipSetStale} against the committed facts snapshot. */
export async function isTipSetStaleAgainstCurrentFacts(
  set: MatchupTipSet | GeneralTipSet,
): Promise<boolean> {
  const unit = tipSetUnit(set);
  const groundings = await Promise.all(
    unit.championIds.map((championId) => loadChampionGrounding(championId)),
  );
  return isTipSetStale(set, groundings);
}
