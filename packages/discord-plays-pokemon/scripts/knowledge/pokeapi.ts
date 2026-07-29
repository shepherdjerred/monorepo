import { z } from "zod";
import { fetchCsv } from "./fetch.ts";
import {
  compactList,
  humanizeIdentifier,
  type KnowledgeRecord,
  type Sources,
} from "./model.ts";

const IntegerString = z.string().regex(/^\d+$/).transform(Number);
const OptionalIntegerString = z
  .string()
  .transform((value) => (value === "" ? undefined : Number(value)))
  .pipe(z.number().int().optional());

const SpeciesRows = z.array(
  z.object({
    id: IntegerString,
    identifier: z.string().min(1),
    generation_id: IntegerString,
    evolves_from_species_id: OptionalIntegerString,
    capture_rate: IntegerString,
    is_legendary: z.enum(["0", "1"]),
    is_mythical: z.enum(["0", "1"]),
  }),
);
const PokemonRows = z.array(
  z.object({
    id: IntegerString,
    identifier: z.string().min(1),
    species_id: IntegerString,
    height: IntegerString,
    weight: IntegerString,
    base_experience: OptionalIntegerString,
    is_default: z.enum(["0", "1"]),
  }),
);
const PokemonTypeRows = z.array(
  z.object({
    pokemon_id: IntegerString,
    type_id: IntegerString,
    slot: IntegerString,
  }),
);
const PokemonTypePastRows = z.array(
  z.object({
    pokemon_id: IntegerString,
    generation_id: IntegerString,
    type_id: IntegerString,
    slot: IntegerString,
  }),
);
const TypeRows = z.array(
  z.object({
    id: IntegerString,
    identifier: z.string().min(1),
  }),
);
const MoveRows = z.array(
  z.object({
    id: IntegerString,
    identifier: z.string().min(1),
    generation_id: IntegerString,
    type_id: IntegerString,
    power: OptionalIntegerString,
    pp: OptionalIntegerString,
    accuracy: OptionalIntegerString,
    priority: z
      .string()
      .regex(/^-?\d+$/)
      .transform(Number),
    damage_class_id: IntegerString,
  }),
);
const PokemonMoveRows = z.array(
  z.object({
    pokemon_id: IntegerString,
    version_group_id: IntegerString,
    move_id: IntegerString,
    pokemon_move_method_id: IntegerString,
    level: IntegerString,
  }),
);
const MoveChangelogRows = z.array(
  z.object({
    move_id: IntegerString,
    changed_in_version_group_id: IntegerString,
    type_id: OptionalIntegerString,
    power: OptionalIntegerString,
    pp: OptionalIntegerString,
    accuracy: OptionalIntegerString,
    priority: OptionalIntegerString,
  }),
);
const ItemRows = z.array(
  z.object({
    id: IntegerString,
    identifier: z.string().min(1),
    category_id: IntegerString,
    cost: IntegerString,
  }),
);
const ItemIndexRows = z.array(
  z.object({
    item_id: IntegerString,
    generation_id: IntegerString,
    game_index: IntegerString,
  }),
);

type PokemonTypeRow = z.infer<typeof PokemonTypeRows>[number];
type PokemonTypePastRow = z.infer<typeof PokemonTypePastRows>[number];
type MoveRow = z.infer<typeof MoveRows>[number];
type MoveChangelogRow = z.infer<typeof MoveChangelogRows>[number];

function rawUrl(sources: Sources, file: string): string {
  return `https://raw.githubusercontent.com/PokeAPI/pokeapi/${sources.pokeapi.commit}/${sources.pokeapi.csvPath}/${file}`;
}

function valuesByKey<T>(
  entries: readonly T[],
  key: (entry: T) => number,
): Map<number, T[]> {
  const result = new Map<number, T[]>();
  for (const entry of entries) {
    const id = key(entry);
    result.set(id, [...(result.get(id) ?? []), entry]);
  }
  return result;
}

function typesForGeneration(
  current: readonly PokemonTypeRow[],
  past: readonly PokemonTypePastRow[],
  generationId: number,
): (PokemonTypeRow | PokemonTypePastRow)[] {
  const applicableGeneration = Math.min(
    ...past
      .filter((entry) => entry.generation_id >= generationId)
      .map((entry) => entry.generation_id),
  );
  return Number.isFinite(applicableGeneration)
    ? past.filter((entry) => entry.generation_id === applicableGeneration)
    : [...current];
}

function moveForVersion(
  move: MoveRow,
  changelog: readonly MoveChangelogRow[],
  versionGroupId: number,
): Pick<MoveRow, "type_id" | "power" | "pp" | "accuracy" | "priority"> {
  const historical = changelog
    .filter((entry) => entry.changed_in_version_group_id > versionGroupId)
    .sort(
      (left, right) =>
        left.changed_in_version_group_id - right.changed_in_version_group_id,
    )
    .at(0);
  return {
    type_id: historical?.type_id ?? move.type_id,
    power: historical?.power ?? move.power,
    pp: historical?.pp ?? move.pp,
    accuracy: historical?.accuracy ?? move.accuracy,
    priority: historical?.priority ?? move.priority,
  };
}

function rarityTag(isLegendary: "0" | "1"): string {
  return isLegendary === "1" ? "legendary" : "ordinary";
}

const GENERATION_3_PHYSICAL_TYPES = new Set([
  "normal",
  "fighting",
  "flying",
  "poison",
  "ground",
  "rock",
  "bug",
  "ghost",
  "steel",
]);

const STATUS_DAMAGE_CLASS_ID = 1;
const PHYSICAL_DAMAGE_CLASS_ID = 2;
const SPECIAL_DAMAGE_CLASS_ID = 3;

export function generation3DamageClass(
  type: string,
  damageClassId: number,
): "physical" | "special" | "status" {
  if (damageClassId === STATUS_DAMAGE_CLASS_ID) return "status";
  if (
    damageClassId !== PHYSICAL_DAMAGE_CLASS_ID &&
    damageClassId !== SPECIAL_DAMAGE_CLASS_ID
  ) {
    throw new Error(
      `unknown PokeAPI move damage class id ${String(damageClassId)}`,
    );
  }
  return GENERATION_3_PHYSICAL_TYPES.has(type) ? "physical" : "special";
}

export function generation3PowerLabel(
  power: number | undefined,
  damageClass: "physical" | "special" | "status",
): string {
  if (power !== undefined) return String(power);
  return damageClass === "status" ? "status" : "fixed or variable";
}

export const CONFIRMED_FRLG_ONLY_ITEM_IDENTIFIERS = [
  "tea",
  "tri-pass",
  "rainbow-pass",
  "ruby",
  "sapphire",
] as const;

const confirmedFrlgOnlyItemIdentifiers = new Set<string>(
  CONFIRMED_FRLG_ONLY_ITEM_IDENTIFIERS,
);

export function includeGeneration3Item(identifier: string): boolean {
  return !confirmedFrlgOnlyItemIdentifiers.has(identifier);
}

export async function buildPokeApiRecords(
  sources: Sources,
): Promise<KnowledgeRecord[]> {
  const [
    species,
    pokemon,
    pokemonTypes,
    pokemonTypesPast,
    types,
    moves,
    moveChangelog,
    pokemonMoves,
    items,
    itemIndices,
  ] = await Promise.all([
    fetchCsv(rawUrl(sources, "pokemon_species.csv"), SpeciesRows),
    fetchCsv(rawUrl(sources, "pokemon.csv"), PokemonRows),
    fetchCsv(rawUrl(sources, "pokemon_types.csv"), PokemonTypeRows),
    fetchCsv(rawUrl(sources, "pokemon_types_past.csv"), PokemonTypePastRows),
    fetchCsv(rawUrl(sources, "types.csv"), TypeRows),
    fetchCsv(rawUrl(sources, "moves.csv"), MoveRows),
    fetchCsv(rawUrl(sources, "move_changelog.csv"), MoveChangelogRows),
    fetchCsv(rawUrl(sources, "pokemon_moves.csv"), PokemonMoveRows),
    fetchCsv(rawUrl(sources, "items.csv"), ItemRows),
    fetchCsv(rawUrl(sources, "item_game_indices.csv"), ItemIndexRows),
  ]);
  const typeNames = new Map(types.map((row) => [row.id, row.identifier]));
  const moveById = new Map(moves.map((row) => [row.id, row]));
  const speciesById = new Map(species.map((row) => [row.id, row]));
  const formsBySpecies = valuesByKey(
    pokemon.filter((row) => row.is_default === "1"),
    (row) => row.species_id,
  );
  const typesByPokemon = valuesByKey(pokemonTypes, (row) => row.pokemon_id);
  const pastTypesByPokemon = valuesByKey(
    pokemonTypesPast,
    (row) => row.pokemon_id,
  );
  const changelogByMove = valuesByKey(moveChangelog, (row) => row.move_id);
  const movesByPokemon = valuesByKey(
    pokemonMoves.filter(
      (row) => row.version_group_id === sources.pokeapi.versionGroupId,
    ),
    (row) => row.pokemon_id,
  );
  const sourceUrl = `${sources.pokeapi.repository}/tree/${sources.pokeapi.commit}/${sources.pokeapi.csvPath}`;
  const source = {
    id: "pokeapi" as const,
    url: sourceUrl,
    license: sources.pokeapi.license,
    revision: sources.pokeapi.commit,
  };

  const records: KnowledgeRecord[] = [];
  for (const row of species.filter(
    (entry) => entry.generation_id <= sources.pokeapi.generationId,
  )) {
    const form = formsBySpecies.get(row.id)?.at(0);
    if (form === undefined) {
      throw new Error(`default form missing for species ${row.identifier}`);
    }
    const versionTypes = typesForGeneration(
      typesByPokemon.get(form.id) ?? [],
      pastTypesByPokemon.get(form.id) ?? [],
      sources.pokeapi.generationId,
    );
    const typeList = versionTypes
      .sort((left, right) => left.slot - right.slot)
      .map(
        (entry) =>
          typeNames.get(entry.type_id) ?? `type-${String(entry.type_id)}`,
      );
    const learnedMoves = (movesByPokemon.get(form.id) ?? [])
      .filter((entry) => entry.pokemon_move_method_id === 1)
      .sort((left, right) => left.level - right.level)
      .map((entry) => {
        const move = moveById.get(entry.move_id);
        return `${String(entry.level)}:${move?.identifier ?? `move-${String(entry.move_id)}`}`;
      });
    const predecessor =
      row.evolves_from_species_id === undefined
        ? "none"
        : (speciesById.get(row.evolves_from_species_id)?.identifier ??
          `species-${String(row.evolves_from_species_id)}`);
    records.push({
      id: `species:${row.identifier}`,
      domain: "species",
      title: humanizeIdentifier(row.identifier),
      aliases: [row.identifier, `National Dex ${String(row.id)}`],
      tags: [
        ...typeList,
        `generation-${String(row.generation_id)}`,
        rarityTag(row.is_legendary),
      ],
      body: [
        `National Pokédex: ${String(row.id)}`,
        `Types: ${typeList.join("/")}`,
        `Height: ${String(form.height / 10)} m; weight: ${String(form.weight / 10)} kg`,
        `Base experience: ${String(form.base_experience ?? 0)}; capture rate: ${String(row.capture_rate)}`,
        `Evolves from: ${predecessor}`,
        `Emerald level-up moves (level:move): ${compactList(learnedMoves, 60) || "none"}`,
      ].join("\n"),
      source,
    });
  }

  for (const move of moves.filter(
    (entry) => entry.generation_id <= sources.pokeapi.generationId,
  )) {
    const versioned = moveForVersion(
      move,
      changelogByMove.get(move.id) ?? [],
      sources.pokeapi.versionGroupId,
    );
    const typeName =
      typeNames.get(versioned.type_id) ?? `type-${String(versioned.type_id)}`;
    const damageClass = generation3DamageClass(typeName, move.damage_class_id);
    records.push({
      id: `battle:move:${move.identifier}`,
      domain: "battle",
      title: humanizeIdentifier(move.identifier),
      aliases: [move.identifier],
      tags: [typeName, damageClass],
      body: [
        `Type: ${typeName}`,
        `Power: ${generation3PowerLabel(versioned.power, damageClass)}; accuracy: ${String(versioned.accuracy ?? "always")}; PP: ${String(versioned.pp ?? "unknown")}`,
        `Priority: ${String(versioned.priority)}; Generation III damage class: ${damageClass}`,
      ].join("\n"),
      source,
    });
  }

  // PokeAPI's item_game_indices table is generation-scoped, not
  // version-scoped. Its Generation III rows include FireRed/LeafGreen key
  // items, and the pinned pokeemerald constants retain those IDs for
  // cross-game compatibility rather than proving Emerald availability.
  const generation3ItemIds = new Set(
    itemIndices
      .filter((entry) => entry.generation_id === sources.pokeapi.generationId)
      .map((entry) => entry.item_id),
  );
  for (const item of items.filter(
    (entry) =>
      generation3ItemIds.has(entry.id) &&
      includeGeneration3Item(entry.identifier),
  )) {
    records.push({
      id: `items:${item.identifier}`,
      domain: "items",
      title: humanizeIdentifier(item.identifier),
      aliases: [item.identifier],
      tags: [
        "generation-3",
        "availability-unverified",
        `category-${String(item.category_id)}`,
      ],
      body: [
        `Generation III item identifier: ${item.identifier}`,
        "Availability: this generation-wide catalog entry does not prove the item is obtainable in Pokémon Emerald.",
        `Shop cost: ${String(item.cost)}; category id: ${String(item.category_id)}`,
      ].join("\n"),
      source,
    });
  }

  return records;
}
