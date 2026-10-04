import {
  browserChampions,
  getGameAsset,
  gameAssetManifest,
} from "@scout-for-lol/data/browser-assets";
import {
  items,
  findRunes,
  findSummonerSpells,
  getChampionInfo,
  getAbilityFacts,
  type ExploreMessage,
} from "@scout-for-lol/data";

type Entity = NonNullable<ExploreMessage["inlineEntities"]>[number];
type Facts = Omit<Entity, "marker" | "version">;
const text = (value: string) =>
  value
    .replaceAll(/<br\s*\/?>/gu, " ")
    .replaceAll(/<[^>]*>/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

async function championFacts(id: string): Promise<Facts | undefined> {
  const champion = browserChampions.find(
    (value) => value.key === id || String(value.id) === id,
  );
  if (champion === undefined) return undefined;
  const info = await getChampionInfo(champion.key);
  if (info === undefined)
    throw new Error(`Bundled champion facts missing for ${champion.key}`);
  return {
    kind: "champion",
    assetKey: champion.key,
    name: champion.name,
    description: `${info.tags.join(", ")}. Passive: ${info.passive.name}. ${text(info.passive.description)}`,
  };
}

async function abilityFacts(id: string): Promise<Facts | undefined> {
  const [champion, slot] = id.split("-");
  if (
    champion === undefined ||
    !["passive", "Q", "W", "E", "R"].includes(slot ?? "")
  )
    return undefined;
  const found = await getAbilityFacts(champion);
  if (found.status === "not_found") return undefined;
  const ability = Object.entries(found.facts.abilities).find(
    ([name]) => name === slot,
  )?.[1];
  return ability === undefined
    ? undefined
    : {
        kind: "ability",
        assetKey: id,
        name: `${found.facts.championName} ${slot ?? ""}: ${ability.name}`,
        description: text(ability.resolvedDescription),
      };
}

async function catalogFacts(
  kind: string | undefined,
  id: string,
): Promise<Facts | undefined> {
  switch (kind) {
    case undefined:
      return undefined;
    case "item": {
      const item = items.data[id];
      return item === undefined
        ? undefined
        : {
            kind,
            assetKey: id,
            name: item.name,
            description: `${text(item.description)} Gold: ${item.gold.total.toString()}.`,
          };
    }
    case "rune": {
      const rune = findRunes(id).find((value) => String(value.id) === id);
      return rune === undefined
        ? undefined
        : {
            kind,
            assetKey:
              rune.icon
                .split("/")
                .at(-1)
                ?.replace(/\.png$/u, "") ?? "",
            name: rune.name,
            description: text(rune.longDesc),
          };
    }
    case "spell": {
      const spell = findSummonerSpells(id).find(
        (value) => value.id === id || value.key === id,
      );
      return spell === undefined
        ? undefined
        : {
            kind,
            assetKey: spell.id,
            name: spell.name,
            description: `${text(spell.description)} Cooldown: ${spell.cooldownBurn}s.`,
          };
    }
    case "champion":
      return await championFacts(id);
    case "ability":
      return await abilityFacts(id);
    default:
      return undefined;
  }
}

/** Only closed catalog identities can become icons; model URLs are never fetched. */
export async function hydrateInlineEntities(
  markdown: string,
): Promise<Entity[]> {
  const markers = [
    ...new Set(
      [
        ...markdown.matchAll(
          /\]\((scout:\/\/(?:champion|ability|item|rune|spell)\/[\w-]+)\)/gu,
        ),
      ].map((match) => match[1]),
    ),
  ].slice(0, 100);
  const entities: Entity[] = [];
  for (const marker of markers) {
    if (marker === undefined) continue;
    const [kind, id] = marker.slice("scout://".length).split("/");
    if (id === undefined) continue;
    const entity = await catalogFacts(kind, id);
    if (entity === undefined) continue;
    getGameAsset(entity.kind, entity.assetKey);
    entities.push({
      ...entity,
      marker,
      version: gameAssetManifest.sourceVersion,
    });
  }
  return entities;
}
