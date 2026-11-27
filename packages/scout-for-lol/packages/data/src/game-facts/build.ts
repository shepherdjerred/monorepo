import {
  GameFactSchema,
  gameFactPath,
  type AbilityFact,
  type ChampionFact,
  type GameFact,
  type GameFactEntry,
  type GameFactPart,
  type ItemFact,
  type KeywordFact,
  type RuneFact,
  type SummonerSpellFact,
} from "#src/game-facts/schema.ts";
import {
  formatByRank,
  hasUnresolvedToken,
  resolvedLeadingText,
  stripMarkup,
  trimDescription,
} from "#src/game-facts/text.ts";

/**
 * Pure builders from the Data Dragon snapshot to per-entity tooltip facts.
 * Nothing here reads a file; `sources.ts` loads the snapshot and
 * `scripts/generate-game-facts.ts` writes the result.
 */

export type ChampionSource = {
  id: string;
  name: string;
  title: string;
  blurb: string;
  tags: string[];
  partype: string;
  stats: { hp: number; movespeed: number; attackrange: number };
  passive: { name: string; description: string };
  /** Q, W, E, R in order. */
  spells: { name: string; description: string }[];
};

export type AbilityFactsSource = {
  championKey: string;
  championName: string;
  abilities: Record<
    AbilitySlot,
    {
      name: string;
      maxRank: number;
      cooldownByRank: number[];
      costByRank: number[];
      costType: string;
      rangeByRank: number[];
      resolvedDescription: string;
    }
  >;
};

export type ItemSource = {
  name: string;
  description: string;
  gold: { base: number; total: number };
  from?: string[] | undefined;
};

export type SummonerSpellSource = {
  key: string;
  name: string;
  description: string;
  cooldown: number[];
  cooldownBurn: string;
  range: number[];
  rangeBurn: string;
  summonerLevel: number;
  image: { full: string };
};

export type RuneTreeSource = {
  name: string;
  slots: {
    runes: {
      id: number;
      name: string;
      icon: string;
      shortDesc: string;
      longDesc: string;
    }[];
  }[];
}[];

/** A keyword from the tips glossary: a status such as "charmed". */
export type KeywordSource = {
  id: string;
  term: string;
  definition: string;
};

export type GameFactSources = {
  patch: string;
  keywords: KeywordSource[];
  champions: ChampionSource[];
  abilityFacts: AbilityFactsSource[];
  items: Record<string, ItemSource>;
  summonerSpells: SummonerSpellSource[];
  runeTrees: RuneTreeSource;
};

type AbilitySlot = AbilityFact["slot"];

const ABILITY_SLOTS = ["Q", "W", "E", "R"] as const;
const MAX_ITEM_SUMMARY = 280;
const NO_COST = /^(?:no cost|passive)$/i;
const ABILITY_TOKEN = /\s*\(?\{\{[^}]*\}\}\)?/g;

function sizeLabel(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function iconOf(kind: "item" | "rune" | "spell", file: string): string {
  return `img/${kind}/${file}`;
}

// --- Champion and abilities -------------------------------------------------

function abilityKey(championKey: string, slot: AbilitySlot): string {
  return `${championKey}-${slot}`;
}

function abilityPart(
  championKey: string,
  slot: AbilitySlot,
  name: string,
): GameFactPart {
  const key = abilityKey(championKey, slot);
  return { kind: "ability", key, name, icon: `img/ability/${key}.png` };
}

export function buildChampionFact(
  patch: string,
  champion: ChampionSource,
  abilityFacts: AbilityFactsSource,
): ChampionFact {
  const { abilities } = abilityFacts;
  const championKey = champion.id;
  return {
    patch,
    kind: "champion",
    key: championKey,
    name: champion.name,
    icon: `img/champion/${championKey}.png`,
    art: `img/champion-splash/${championKey}_0.jpg`,
    title: champion.title,
    roles: champion.tags,
    keyFact: { label: "Roles", value: champion.tags.join(", ") },
    facts: [
      { label: "Health", value: sizeLabel(champion.stats.hp) },
      { label: "Move speed", value: sizeLabel(champion.stats.movespeed) },
      { label: "Attack range", value: sizeLabel(champion.stats.attackrange) },
    ],
    description: trimDescription(stripMarkup(champion.blurb)),
    parts: [
      abilityPart(championKey, "passive", abilities.passive.name),
      ...ABILITY_SLOTS.map((slot) =>
        abilityPart(championKey, slot, abilities[slot].name),
      ),
    ],
  };
}

function abilityDescription(
  resolvedDescription: string,
  gameDescription: string,
): string {
  const resolved = resolvedLeadingText(stripMarkup(resolvedDescription));
  if (resolved.length > 0) return resolved;
  // The generator left no usable numbers (or no text); the game's own short
  // description carries no tokens.
  const fallback = trimDescription(stripMarkup(gameDescription));
  if (hasUnresolvedToken(fallback)) {
    throw new Error(`Ability description still has a token: ${fallback}`);
  }
  return fallback;
}

function abilityCostFact(
  costType: string,
  costByRank: number[],
): GameFactEntry | undefined {
  const type = costType.replaceAll(ABILITY_TOKEN, "").trim();
  if (NO_COST.test(type) || costByRank.every((cost) => cost === 0)) {
    return undefined;
  }
  const amount = formatByRank(costByRank);
  return {
    label: "Cost",
    value: type.startsWith("%") ? `${amount}${type}` : `${amount} ${type}`,
  };
}

export function buildAbilityFact(
  patch: string,
  champion: ChampionSource,
  slot: AbilitySlot,
  abilityFacts: AbilityFactsSource,
): AbilityFact {
  const championKey = champion.id;
  const ability = abilityFacts.abilities[slot];
  const game =
    slot === "passive"
      ? champion.passive
      : champion.spells[ABILITY_SLOTS.indexOf(slot)];
  if (game?.name !== ability.name) {
    throw new Error(
      `${championKey} ${slot}: ability-facts name "${ability.name}" does not match Data Dragon "${game?.name ?? "missing"}"`,
    );
  }
  const costFact = abilityCostFact(ability.costType, ability.costByRank);
  const hasRange = ability.rangeByRank.some((range) => range > 0);
  const hasCooldown = ability.cooldownByRank.length > 0;
  const cost = costFact === undefined ? [] : [costFact];
  const range = hasRange
    ? [{ label: "Range", value: formatByRank(ability.rangeByRank) }]
    : [];
  return {
    patch,
    kind: "ability",
    key: abilityKey(championKey, slot),
    name: ability.name,
    icon: `img/ability/${abilityKey(championKey, slot)}.png`,
    slot,
    championKey,
    championName: champion.name,
    maxRank: ability.maxRank,
    cooldownByRank: ability.cooldownByRank,
    costByRank: ability.costByRank,
    costType:
      costFact === undefined
        ? ""
        : ability.costType.replaceAll(ABILITY_TOKEN, "").trim(),
    rangeByRank: ability.rangeByRank,
    keyFact: hasCooldown
      ? {
          label: "Cooldown",
          value: `${formatByRank(ability.cooldownByRank)} s`,
        }
      : { label: "Slot", value: slot === "passive" ? "Passive" : slot },
    facts: [...cost, ...range],
    description: abilityDescription(
      ability.resolvedDescription,
      game.description,
    ),
    parts: [],
  };
}

// --- Items ------------------------------------------------------------------

type ItemStat = GameFactEntry;
type ItemEffect = { name: string; text: string };

const STAT_SEGMENT = /^<(\w+)>([^<]+)<\/\1>(.+)$/;
const EFFECT_HEADING = /<(passive|active)>([\s\S]*?)<\/\1>/g;

function parseItemStats(statsMarkup: string): ItemStat[] {
  return statsMarkup
    .split(/<br\s*\/?>/i)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const match = STAT_SEGMENT.exec(segment);
      const value = match?.[2];
      const label = match?.[3];
      if (value === undefined || label === undefined) {
        throw new Error(`Unrecognised item stat line: ${segment}`);
      }
      return { label: stripMarkup(label), value: value.trim() };
    });
}

/** Split an item description into stats, leading text and named effects. */
export function parseItemDescription(markup: string): {
  stats: ItemStat[];
  lead: string;
  effects: ItemEffect[];
} {
  const main = /<mainText>([\s\S]*?)<\/mainText>/.exec(markup)?.[1] ?? markup;
  const statsBlock = /<stats>([\s\S]*?)<\/stats>/.exec(main)?.[1];
  const rest = main.replace(/<stats>[\s\S]*?<\/stats>/, "");
  const headings = [...rest.matchAll(EFFECT_HEADING)];
  const lead = stripMarkup(rest.slice(0, headings[0]?.index ?? rest.length));
  const effects = headings.map((heading, index) => {
    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = headings[index + 1]?.index ?? rest.length;
    return {
      name: stripMarkup(heading[2] ?? "").replace(/:$/, ""),
      text: stripMarkup(rest.slice(bodyStart, bodyEnd)),
    };
  });
  return {
    stats: statsBlock === undefined ? [] : parseItemStats(statsBlock),
    lead,
    effects,
  };
}

/**
 * Item summary derived from the item's own stats and passive text. Data
 * Dragon's `plaintext` is never read: it is unreliable (Malignance carries
 * another item's sentence, Tracker AI-953).
 */
function itemSummary(parsed: ReturnType<typeof parseItemDescription>): string {
  const candidates = [
    ...(parsed.lead.length > 0 ? [trimDescription(parsed.lead, 1)] : []),
    ...parsed.effects
      .filter((effect) => effect.name.length > 0)
      .map((effect) =>
        effect.text.length === 0
          ? `${effect.name}.`
          : `${effect.name}: ${trimDescription(effect.text, 1)}`,
      ),
  ];
  // A few items ship with unresolved `{{ token }}` text in Data Dragon itself;
  // a segment that still has one says nothing true, and repeated segments say
  // nothing new.
  const segments = [...new Set(candidates)].filter(
    (segment) => !hasUnresolvedToken(segment),
  );
  const [first, second] = segments;
  if (first !== undefined) {
    return second !== undefined &&
      first.length + 1 + second.length <= MAX_ITEM_SUMMARY
      ? `${first} ${second}`
      : first;
  }
  if (parsed.stats.length === 0) return "";
  const granted = parsed.stats.map((stat) => `${stat.value} ${stat.label}`);
  return `Grants ${granted.join(", ")}.`;
}

export function buildItemFact(
  patch: string,
  id: string,
  items: Record<string, ItemSource>,
): ItemFact {
  const item = items[id];
  if (item === undefined) throw new Error(`Unknown item ${id}`);
  const parsed = parseItemDescription(item.description);
  const parts = (item.from ?? []).map((partId): GameFactPart => {
    const part = items[partId];
    if (part === undefined) {
      throw new Error(`Item ${id} builds from unknown item ${partId}`);
    }
    return {
      kind: "item",
      key: partId,
      name: part.name,
      icon: iconOf("item", `${partId}.png`),
    };
  });
  return {
    patch,
    kind: "item",
    key: id,
    name: item.name,
    icon: iconOf("item", `${id}.png`),
    goldTotal: item.gold.total,
    goldCombine: item.gold.base,
    keyFact: {
      label: "Cost",
      value: item.gold.total === 0 ? "Free" : `${String(item.gold.total)} gold`,
    },
    facts: parsed.stats,
    description: itemSummary(parsed),
    parts,
  };
}

// --- Runes and summoner spells ----------------------------------------------

/** `Cooldown: 20s` style lines from a rune's long description. */
function runeDetailFacts(longDesc: string): GameFactEntry[] {
  return longDesc
    .split(/<br\s*\/?>/i)
    .map((segment) => stripMarkup(segment))
    .flatMap((line): GameFactEntry[] => {
      const match = /^(Damage|Cooldown):(.+?)\.?$/.exec(line);
      const label = match?.[1];
      const value = match?.[2];
      return label === undefined || value === undefined
        ? []
        : [{ label, value: value.trim() }];
    });
}

export function buildRuneFacts(
  patch: string,
  trees: RuneTreeSource,
): RuneFact[] {
  return trees.flatMap((tree) =>
    tree.slots.flatMap((slot, slotIndex) =>
      slot.runes.map((rune): RuneFact => ({
        patch,
        kind: "rune",
        key: String(rune.id),
        name: rune.name,
        icon: iconOf("rune", rune.icon.split("/").pop() ?? rune.icon),
        tree: tree.name,
        keyFact: { label: "Tree", value: tree.name },
        facts: [
          { label: "Type", value: slotIndex === 0 ? "Keystone" : "Rune" },
          ...runeDetailFacts(rune.longDesc),
        ],
        description: trimDescription(stripMarkup(rune.shortDesc)),
        parts: [],
      })),
    ),
  );
}

export function buildSummonerSpellFact(
  patch: string,
  spell: SummonerSpellSource,
): SummonerSpellFact {
  const cooldown = spell.cooldown[0];
  if (cooldown === undefined) {
    throw new Error(`Summoner spell ${spell.name} has no cooldown`);
  }
  const hasRange = spell.range.some((range) => range > 0);
  return {
    patch,
    kind: "summoner-spell",
    key: spell.key,
    name: spell.name,
    icon: iconOf("spell", spell.image.full),
    cooldownSeconds: cooldown,
    keyFact: { label: "Cooldown", value: `${spell.cooldownBurn} s` },
    facts: [
      ...(hasRange ? [{ label: "Range", value: spell.rangeBurn }] : []),
      { label: "Unlocks", value: `Level ${String(spell.summonerLevel)}` },
    ],
    description: trimDescription(stripMarkup(spell.description)),
    parts: [],
  };
}

// --- Keywords ---------------------------------------------------------------

export function buildKeywordFact(
  patch: string,
  keyword: KeywordSource,
): KeywordFact {
  return {
    kind: "keyword",
    patch,
    key: keyword.id,
    name: keyword.term,
    description: keyword.definition,
    facts: [],
    parts: [],
    icon: null,
    keyFact: null,
  };
}

// --- Everything -------------------------------------------------------------

export function buildAllGameFacts(sources: GameFactSources): GameFact[] {
  const abilityByKey = new Map(
    sources.abilityFacts.map((facts) => [facts.championKey, facts]),
  );
  const champions = sources.champions.flatMap((champion) => {
    const abilityFacts = abilityByKey.get(champion.id);
    if (abilityFacts === undefined) {
      throw new Error(`No ability facts for champion ${champion.id}`);
    }
    return [
      buildChampionFact(sources.patch, champion, abilityFacts),
      ...(["passive", ...ABILITY_SLOTS] as const).map((slot) =>
        buildAbilityFact(sources.patch, champion, slot, abilityFacts),
      ),
    ];
  });
  // Data Dragon keeps a few unnamed internal items; with no name there is no
  // tooltip header, and no match shows one.
  const items = Object.keys(sources.items)
    .filter((id) => (sources.items[id]?.name ?? "").trim().length > 0)
    .toSorted((left, right) => Number(left) - Number(right))
    .map((id) => buildItemFact(sources.patch, id, sources.items));
  const spells = sources.summonerSpells.map((spell) =>
    buildSummonerSpellFact(sources.patch, spell),
  );
  return [
    ...champions,
    ...items,
    ...buildRuneFacts(sources.patch, sources.runeTrees),
    ...spells,
    ...sources.keywords
      .toSorted((left, right) => left.id.localeCompare(right.id))
      .map((keyword) => buildKeywordFact(sources.patch, keyword)),
  ].map((fact) => {
    const parsed = GameFactSchema.safeParse(fact);
    if (!parsed.success) {
      throw new Error(
        `Invalid game fact ${fact.kind}/${fact.key}: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  });
}

/** Path below the game asset root and exact bytes of one emitted fact file. */
export function gameFactFile(fact: GameFact): {
  path: string;
  content: string;
} {
  return {
    path: gameFactPath(fact.kind, fact.key),
    content: `${JSON.stringify(fact, undefined, 2)}\n`,
  };
}
