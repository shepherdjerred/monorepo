import { z } from "zod";
import { humanizeIdentifier } from "./model.ts";

const IntegerString = z.string().regex(/^\d+$/).transform(Number);
const OptionalIntegerString = z
  .string()
  .transform((value) => (value === "" ? undefined : Number(value)))
  .pipe(z.number().int().optional());

export const PokemonFormRows = z.array(
  z.object({
    pokemon_id: IntegerString,
    introduced_in_version_group_id: IntegerString,
    is_default: z.enum(["0", "1"]),
    is_battle_only: z.enum(["0", "1"]),
    form_order: IntegerString,
  }),
);
export const EvolutionRows = z.array(
  z.object({
    evolved_species_id: IntegerString,
    evolution_trigger_id: IntegerString,
    version_group_id: OptionalIntegerString,
    is_default: z.enum(["0", "1"]),
    trigger_item_id: OptionalIntegerString,
    minimum_level: OptionalIntegerString,
    gender_id: OptionalIntegerString,
    held_item_id: OptionalIntegerString,
    time_of_day: z.string(),
    known_move_id: OptionalIntegerString,
    known_move_type_id: OptionalIntegerString,
    minimum_happiness: OptionalIntegerString,
    minimum_beauty: OptionalIntegerString,
    relative_physical_stats: OptionalIntegerString,
    trade_species_id: OptionalIntegerString,
  }),
);
export const EvolutionTriggerRows = z.array(
  z.object({
    id: IntegerString,
    identifier: z.string().min(1),
  }),
);

export type PokemonFormRow = z.infer<typeof PokemonFormRows>[number];
export type EvolutionRow = z.infer<typeof EvolutionRows>[number];

export function generation3HappinessThreshold(
  minimumHappiness: number | undefined,
): number | undefined {
  // PokeAPI's evolution rows identify friendship evolutions for the target
  // version group, but minimum_happiness is maintained as current data. Every
  // friendship evolution in Emerald uses the Generation III threshold of 220.
  return minimumHappiness === undefined ? undefined : 220;
}

export function requirePokeApiReference<T>(
  values: ReadonlyMap<number, T>,
  id: number,
  referencedTable: string,
  context: string,
): T {
  const value = values.get(id);
  if (value === undefined) {
    throw new Error(
      `PokeAPI ${context} references missing ${referencedTable} row ${String(id)}`,
    );
  }
  return value;
}

export function pokemonForVersion<
  T extends Readonly<{ id: number; is_default: "0" | "1" }>,
>(
  pokemon: readonly T[],
  forms: ReadonlyMap<number, readonly PokemonFormRow[]>,
  versionGroupId: number,
): T | undefined {
  const versionForms = pokemon
    .flatMap((entry) =>
      (forms.get(entry.id) ?? []).map((form) => ({ entry, form })),
    )
    .filter(
      ({ form }) =>
        form.is_default === "1" &&
        form.is_battle_only === "0" &&
        form.introduced_in_version_group_id <= versionGroupId,
    )
    .sort(
      (left, right) =>
        right.form.introduced_in_version_group_id -
          left.form.introduced_in_version_group_id ||
        left.form.form_order - right.form.form_order,
    );
  return (
    versionForms.at(0)?.entry ??
    pokemon.find((entry) => entry.is_default === "1")
  );
}

export function evolutionsForVersion(
  evolutions: readonly EvolutionRow[],
  versionGroupId: number,
): EvolutionRow[] {
  const applicable = evolutions.filter(
    (entry) =>
      entry.version_group_id !== undefined &&
      entry.version_group_id <= versionGroupId,
  );
  const latestVersionGroup = Math.max(
    ...applicable.map((entry) => entry.version_group_id ?? 0),
  );
  return Number.isFinite(latestVersionGroup)
    ? applicable.filter(
        (entry) => entry.version_group_id === latestVersionGroup,
      )
    : [];
}

export type EvolutionReferences = {
  triggers: ReadonlyMap<number, string>;
  items: ReadonlyMap<number, { identifier: string }>;
  moves: ReadonlyMap<number, { identifier: string }>;
  species: ReadonlyMap<number, { identifier: string }>;
  types: ReadonlyMap<number, string>;
};

type SpeciesReference = Readonly<{
  id: number;
  identifier: string;
  generation_id: number;
  evolves_from_species_id?: number | undefined;
}>;

function evolutionCondition(
  evolution: EvolutionRow,
  references: EvolutionReferences,
): string {
  const trigger = requirePokeApiReference(
    references.triggers,
    evolution.evolution_trigger_id,
    "evolution_triggers",
    `evolution for species ${String(evolution.evolved_species_id)}`,
  );
  const details: string[] = [humanizeIdentifier(trigger)];
  if (evolution.minimum_level !== undefined) {
    details.push(`level ${String(evolution.minimum_level)}`);
  }
  if (evolution.trigger_item_id !== undefined) {
    const item = requirePokeApiReference(
      references.items,
      evolution.trigger_item_id,
      "items",
      `trigger item for species ${String(evolution.evolved_species_id)}`,
    );
    details.push(humanizeIdentifier(item.identifier));
  }
  if (evolution.held_item_id !== undefined) {
    const item = requirePokeApiReference(
      references.items,
      evolution.held_item_id,
      "items",
      `held item for species ${String(evolution.evolved_species_id)}`,
    );
    details.push(`holding ${humanizeIdentifier(item.identifier)}`);
  }
  const happiness = generation3HappinessThreshold(evolution.minimum_happiness);
  if (happiness !== undefined) {
    details.push(`happiness ${String(happiness)}+`);
  }
  if (evolution.minimum_beauty !== undefined) {
    details.push(`beauty ${String(evolution.minimum_beauty)}+`);
  }
  if (evolution.time_of_day.length > 0) {
    details.push(evolution.time_of_day);
  }
  if (evolution.known_move_id !== undefined) {
    const move = requirePokeApiReference(
      references.moves,
      evolution.known_move_id,
      "moves",
      `known move for species ${String(evolution.evolved_species_id)}`,
    );
    details.push(`knowing ${humanizeIdentifier(move.identifier)}`);
  }
  if (evolution.known_move_type_id !== undefined) {
    const type = requirePokeApiReference(
      references.types,
      evolution.known_move_type_id,
      "types",
      `known move type for species ${String(evolution.evolved_species_id)}`,
    );
    details.push(`knowing a ${type}-type move`);
  }
  if (evolution.trade_species_id !== undefined) {
    const species = requirePokeApiReference(
      references.species,
      evolution.trade_species_id,
      "pokemon_species",
      `trade species for species ${String(evolution.evolved_species_id)}`,
    );
    details.push(`for ${humanizeIdentifier(species.identifier)}`);
  }
  if (evolution.gender_id !== undefined) {
    details.push(`gender id ${String(evolution.gender_id)}`);
  }
  if (evolution.relative_physical_stats !== undefined) {
    const comparison =
      evolution.relative_physical_stats < 0
        ? "Attack below Defense"
        : evolution.relative_physical_stats > 0
          ? "Attack above Defense"
          : "Attack equal to Defense";
    details.push(comparison);
  }
  return details.join(", ");
}

export function evolutionLine(
  species: Readonly<{ id: number; identifier: string }>,
  evolutions: readonly EvolutionRow[],
  references: EvolutionReferences,
): string {
  if (evolutions.length === 0) {
    throw new Error(
      `PokeAPI species ${species.identifier} has no applicable evolution condition`,
    );
  }
  return evolutions
    .map(
      (evolution) =>
        `${humanizeIdentifier(species.identifier)} (${evolutionCondition(evolution, references)})`,
    )
    .join(" or ");
}

export function speciesEvolutionLines(
  input: Readonly<{
    species: SpeciesReference;
    speciesById: ReadonlyMap<number, SpeciesReference>;
    speciesByPredecessor: ReadonlyMap<number, readonly SpeciesReference[]>;
    evolutionsBySpecies: ReadonlyMap<number, readonly EvolutionRow[]>;
    versionGroupId: number;
    generationId: number;
    references: EvolutionReferences;
  }>,
): Readonly<{ predecessor: string; successors: string[] }> {
  const predecessorSpecies =
    input.species.evolves_from_species_id === undefined
      ? undefined
      : requirePokeApiReference(
          input.speciesById,
          input.species.evolves_from_species_id,
          "pokemon_species",
          `evolution predecessor for species ${input.species.identifier}`,
        );
  const predecessor =
    predecessorSpecies === undefined ||
    predecessorSpecies.generation_id > input.generationId
      ? "none"
      : evolutionLine(
          predecessorSpecies,
          evolutionsForVersion(
            input.evolutionsBySpecies.get(input.species.id) ?? [],
            input.versionGroupId,
          ),
          input.references,
        );
  const successors = (
    input.speciesByPredecessor.get(input.species.id) ?? []
  ).map((successor) =>
    evolutionLine(
      successor,
      evolutionsForVersion(
        input.evolutionsBySpecies.get(successor.id) ?? [],
        input.versionGroupId,
      ),
      input.references,
    ),
  );
  return { predecessor, successors };
}
