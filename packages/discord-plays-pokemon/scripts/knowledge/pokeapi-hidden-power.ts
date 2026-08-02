import {
  humanizeIdentifier,
  type KnowledgeRecord,
  type KnowledgeSource,
} from "./model.ts";

export const HIDDEN_POWER_IDENTIFIER = "hidden-power";

const PHYSICAL_TYPES = [
  "fighting",
  "flying",
  "poison",
  "ground",
  "rock",
  "bug",
  "ghost",
  "steel",
] as const;
const SPECIAL_TYPES = [
  "fire",
  "water",
  "grass",
  "electric",
  "psychic",
  "ice",
  "dragon",
  "dark",
] as const;

type HiddenPowerMove = {
  identifier: string;
};

type HiddenPowerValues = {
  accuracy?: number | undefined;
  pp?: number | undefined;
  priority: number | undefined;
};

export function createHiddenPowerRecord(
  move: HiddenPowerMove,
  versioned: HiddenPowerValues,
  sources: readonly [KnowledgeSource, KnowledgeSource],
): KnowledgeRecord {
  const allTypes = [...PHYSICAL_TYPES, ...SPECIAL_TYPES];
  return {
    id: `battle:move:${move.identifier}`,
    domain: "battle",
    title: humanizeIdentifier(move.identifier),
    aliases: [move.identifier],
    tags: ["variable-type", "variable-power", "physical-or-special"],
    body: [
      `Type: determined by the attacking Pokémon's IVs; one of ${allTypes.join(", ")}.`,
      `Power: 30-70 based on the attacking Pokémon's IVs; accuracy: ${String(versioned.accuracy ?? "always")}; PP: ${String(versioned.pp ?? "unknown")}`,
      versioned.priority === undefined
        ? `Generation III damage class follows the IV-derived type: physical for ${PHYSICAL_TYPES.join(", ")}; special for ${SPECIAL_TYPES.join(", ")}.`
        : `Priority: ${String(versioned.priority)}; Generation III damage class follows the IV-derived type: physical for ${PHYSICAL_TYPES.join(", ")}; special for ${SPECIAL_TYPES.join(", ")}.`,
    ].join("\n"),
    sources: [...sources],
  };
}
