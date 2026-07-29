import { z } from "zod";
import { fetchCsv } from "./fetch.ts";
import {
  compactList,
  humanizeIdentifier,
  type KnowledgeRecord,
  type KnowledgeSource,
  type Sources,
} from "./model.ts";
import {
  createHiddenPowerRecord,
  HIDDEN_POWER_IDENTIFIER,
} from "./pokeapi-hidden-power.ts";
import {
  generation3DamageClass,
  generation3PowerLabel,
  TypeGameIndexRows,
} from "./pokeapi-moves.ts";
import {
  EvolutionRows,
  EvolutionTriggerRows,
  PokemonFormRows,
  pokemonForVersion,
  requirePokeApiReference,
  speciesEvolutionLines,
  type EvolutionReferences,
} from "./pokeapi-relations.ts";

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

export function moveForVersion(
  move: MoveRow,
  changelog: readonly MoveChangelogRow[],
  versionGroupId: number,
): Pick<MoveRow, "type_id" | "power" | "pp" | "accuracy" | "priority"> {
  const historical = changelog
    .filter((entry) => entry.changed_in_version_group_id > versionGroupId)
    .sort(
      (left, right) =>
        left.changed_in_version_group_id - right.changed_in_version_group_id,
    );
  return {
    type_id:
      historical.find((entry) => entry.type_id !== undefined)?.type_id ??
      move.type_id,
    power:
      historical.find((entry) => entry.power !== undefined)?.power ??
      move.power,
    pp: historical.find((entry) => entry.pp !== undefined)?.pp ?? move.pp,
    accuracy:
      historical.find((entry) => entry.accuracy !== undefined)?.accuracy ??
      move.accuracy,
    priority:
      historical.find((entry) => entry.priority !== undefined)?.priority ??
      move.priority,
  };
}

function rarityTag(
  isLegendary: "0" | "1",
  isMythical: "0" | "1",
): "legendary" | "mythical" | "ordinary" {
  if (isLegendary === "1") return "legendary";
  if (isMythical === "1") return "mythical";
  return "ordinary";
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
  pokeemeraldMechanicSource: KnowledgeSource,
  hiddenPowerMechanicSource: KnowledgeSource,
): Promise<KnowledgeRecord[]> {
  const [
    species,
    pokemon,
    pokemonForms,
    pokemonTypes,
    pokemonTypesPast,
    types,
    typeGameIndices,
    moves,
    moveChangelog,
    pokemonMoves,
    items,
    itemIndices,
    evolutions,
    evolutionTriggers,
  ] = await Promise.all([
    fetchCsv(rawUrl(sources, "pokemon_species.csv"), SpeciesRows),
    fetchCsv(rawUrl(sources, "pokemon.csv"), PokemonRows),
    fetchCsv(rawUrl(sources, "pokemon_forms.csv"), PokemonFormRows),
    fetchCsv(rawUrl(sources, "pokemon_types.csv"), PokemonTypeRows),
    fetchCsv(rawUrl(sources, "pokemon_types_past.csv"), PokemonTypePastRows),
    fetchCsv(rawUrl(sources, "types.csv"), TypeRows),
    fetchCsv(rawUrl(sources, "type_game_indices.csv"), TypeGameIndexRows),
    fetchCsv(rawUrl(sources, "moves.csv"), MoveRows),
    fetchCsv(rawUrl(sources, "move_changelog.csv"), MoveChangelogRows),
    fetchCsv(rawUrl(sources, "pokemon_moves.csv"), PokemonMoveRows),
    fetchCsv(rawUrl(sources, "items.csv"), ItemRows),
    fetchCsv(rawUrl(sources, "item_game_indices.csv"), ItemIndexRows),
    fetchCsv(rawUrl(sources, "pokemon_evolution.csv"), EvolutionRows),
    fetchCsv(rawUrl(sources, "evolution_triggers.csv"), EvolutionTriggerRows),
  ]);
  const typeNames = new Map(types.map((row) => [row.id, row.identifier]));
  const generationTypeIds = new Set(
    typeGameIndices
      .filter((entry) => entry.generation_id === sources.pokeapi.generationId)
      .map((entry) => entry.type_id),
  );
  const moveById = new Map(moves.map((row) => [row.id, row]));
  const speciesById = new Map(species.map((row) => [row.id, row]));
  const itemById = new Map(items.map((row) => [row.id, row]));
  const pokemonBySpecies = valuesByKey(pokemon, (row) => row.species_id);
  const formsByPokemon = valuesByKey(pokemonForms, (row) => row.pokemon_id);
  const speciesByPredecessor = valuesByKey(
    species.filter(
      (row) =>
        row.generation_id <= sources.pokeapi.generationId &&
        row.evolves_from_species_id !== undefined,
    ),
    (row) => row.evolves_from_species_id ?? 0,
  );
  const evolutionsBySpecies = valuesByKey(
    evolutions,
    (row) => row.evolved_species_id,
  );
  const evolutionTriggerNames = new Map(
    evolutionTriggers.map((row) => [row.id, row.identifier]),
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
  const source: KnowledgeSource = {
    id: "pokeapi",
    url: sourceUrl,
    license: sources.pokeapi.license,
    revision: sources.pokeapi.commit,
  };
  const evolutionReferences: EvolutionReferences = {
    triggers: evolutionTriggerNames,
    items: itemById,
    moves: moveById,
    species: speciesById,
    types: typeNames,
  };

  const records: KnowledgeRecord[] = [];
  for (const row of species.filter(
    (entry) => entry.generation_id <= sources.pokeapi.generationId,
  )) {
    const form = pokemonForVersion(
      pokemonBySpecies.get(row.id) ?? [],
      formsByPokemon,
      sources.pokeapi.versionGroupId,
    );
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
      .map((entry) =>
        requirePokeApiReference(
          typeNames,
          entry.type_id,
          "types",
          `type assignment for Pokémon ${form.identifier}`,
        ),
      );
    const learnedMoves = (movesByPokemon.get(form.id) ?? [])
      .filter((entry) => entry.pokemon_move_method_id === 1)
      .sort((left, right) => left.level - right.level)
      .map((entry) => {
        const move = requirePokeApiReference(
          moveById,
          entry.move_id,
          "moves",
          `level-up move for Pokémon ${form.identifier}`,
        );
        return `${String(entry.level)}:${move.identifier}`;
      });
    const evolution = speciesEvolutionLines({
      species: row,
      speciesById,
      speciesByPredecessor,
      evolutionsBySpecies,
      versionGroupId: sources.pokeapi.versionGroupId,
      generationId: sources.pokeapi.generationId,
      references: evolutionReferences,
    });
    records.push({
      id: `species:${row.identifier}`,
      domain: "species",
      title: humanizeIdentifier(row.identifier),
      aliases: [row.identifier, `National Dex ${String(row.id)}`],
      tags: [
        ...typeList,
        `generation-${String(row.generation_id)}`,
        rarityTag(row.is_legendary, row.is_mythical),
      ],
      body: [
        `National Pokédex: ${String(row.id)}`,
        `Types: ${typeList.join("/")}`,
        `Height: ${String(form.height / 10)} m; weight: ${String(form.weight / 10)} kg`,
        `Evolves from: ${evolution.predecessor}`,
        `Evolves to: ${evolution.successors.join("; ") || "none"}`,
        `Emerald level-up moves (level:move): ${compactList(learnedMoves, 60) || "none"}`,
      ].join("\n"),
      sources: [
        source,
        ...(["nincada", "shedinja", "wurmple", "silcoon", "cascoon"].includes(
          row.identifier,
        )
          ? [pokeemeraldMechanicSource]
          : []),
      ],
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
    if (!generationTypeIds.has(versioned.type_id)) {
      continue;
    }
    const typeName = requirePokeApiReference(
      typeNames,
      versioned.type_id,
      "types",
      `type for move ${move.identifier}`,
    );
    if (move.identifier === HIDDEN_POWER_IDENTIFIER) {
      records.push(
        createHiddenPowerRecord(move, versioned, [
          source,
          hiddenPowerMechanicSource,
        ]),
      );
      continue;
    }
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
      sources: [source],
    });
  }

  // PokeAPI's generation-scoped item indices include FRLG key items; pinned
  // pokeemerald constants retain those IDs for compatibility rather than
  // proving Emerald availability.
  const generation3ItemIds = new Set(
    itemIndices
      .filter((entry) => entry.generation_id === sources.pokeapi.generationId)
      .map((entry) => entry.item_id),
  );
  for (const itemId of generation3ItemIds) {
    requirePokeApiReference(
      itemById,
      itemId,
      "items",
      "Generation III item index",
    );
  }
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
        `Category id: ${String(item.category_id)}. Price is omitted because PokeAPI's item cost is not version-specific.`,
      ].join("\n"),
      sources: [source],
    });
  }

  return records;
}
