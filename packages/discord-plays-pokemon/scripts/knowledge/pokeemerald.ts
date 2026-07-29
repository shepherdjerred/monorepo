import { fetchText } from "./fetch.ts";
import {
  type KnowledgeRecord,
  type KnowledgeSource,
  type Sources,
} from "./model.ts";

const EVOLUTION_TABLE_PATH = "src/data/pokemon/evolution.h";
const EVOLUTION_SCENE_PATH = "src/evolution_scene.c";
const POKEMON_PATH = "src/pokemon.c";
const ROCK_SMASH_SCRIPT_PATH = "data/maps/MauvilleCity_House1/scripts.inc";

function rawUrl(repository: string, commit: string, file: string): string {
  return `${repository.replace(/\.git$/, "")}/raw/${commit}/${file}`;
}

function normalizedSource(source: string): string {
  return source.replaceAll(/\s+/g, " ").trim();
}

export function validateShedinjaSource(
  evolutionTable: string,
  evolutionScene: string,
): void {
  const normalizedTable = normalizedSource(evolutionTable);
  if (
    !/\[SPECIES_NINCADA\]\s*=\s*\{\s*\{EVO_LEVEL_NINJASK,\s*20,\s*SPECIES_NINJASK\},\s*\{EVO_LEVEL_SHEDINJA,\s*20,\s*SPECIES_SHEDINJA\}\s*\}/.test(
      normalizedTable,
    )
  ) {
    throw new Error(
      "pinned pokeemerald source no longer has the expected level-20 Nincada evolution table",
    );
  }

  const normalizedScene = normalizedSource(evolutionScene);
  if (
    !normalizedScene.includes(
      "gEvolutionTable[preEvoSpecies][0].method == EVO_LEVEL_NINJASK && gPlayerPartyCount < PARTY_SIZE",
    )
  ) {
    throw new Error(
      "pinned pokeemerald source no longer has the expected empty-party-slot Shedinja condition",
    );
  }
  if (normalizedScene.includes("POKE_BALL")) {
    throw new Error(
      "pinned pokeemerald source now checks for a Poké Ball when creating Shedinja; update the generated knowledge requirement",
    );
  }
}

export function validateWurmpleSource(
  evolutionTable: string,
  pokemonSource: string,
): void {
  const normalizedTable = normalizedSource(evolutionTable);
  if (
    !/\[SPECIES_WURMPLE\]\s*=\s*\{\s*\{EVO_LEVEL_SILCOON,\s*7,\s*SPECIES_SILCOON\},\s*\{EVO_LEVEL_CASCOON,\s*7,\s*SPECIES_CASCOON\}\s*\}/.test(
      normalizedTable,
    )
  ) {
    throw new Error(
      "pinned pokeemerald source no longer has the expected level-7 Wurmple evolution table",
    );
  }

  const normalizedPokemon = normalizedSource(pokemonSource);
  if (
    !normalizedPokemon.includes("u16 upperPersonality = personality >> 16;") ||
    !normalizedPokemon.includes(
      "case EVO_LEVEL_SILCOON: if (gEvolutionTable[species][i].param <= level && (upperPersonality % 10) <= 4) targetSpecies = gEvolutionTable[species][i].targetSpecies;",
    ) ||
    !normalizedPokemon.includes(
      "case EVO_LEVEL_CASCOON: if (gEvolutionTable[species][i].param <= level && (upperPersonality % 10) > 4) targetSpecies = gEvolutionTable[species][i].targetSpecies;",
    )
  ) {
    throw new Error(
      "pinned pokeemerald source no longer has the expected hidden-personality Wurmple branch",
    );
  }
}

export function validateRockSmashSource(script: string): void {
  const normalizedScript = normalizedSource(script);
  if (
    !normalizedScript.includes(
      "MauvilleCity_House1_EventScript_RockSmashDude::",
    ) ||
    !normalizedScript.includes("giveitem ITEM_HM_ROCK_SMASH") ||
    !normalizedScript.includes("setflag FLAG_RECEIVED_HM_ROCK_SMASH")
  ) {
    throw new Error(
      "pinned pokeemerald source no longer has the expected Mauville City HM06 Rock Smash gift",
    );
  }
}

export function createPokeemeraldKnowledgeSource(
  license: Sources["pokeemeraldWasm"]["license"],
  upstreamRepository: string,
  commit: string,
): KnowledgeSource {
  return {
    id: "pokeemerald-wasm",
    url: `${upstreamRepository.replace(/\.git$/, "")}/tree/${commit}`,
    license,
    revision: commit,
  };
}

export async function buildPokeemeraldRecords(
  license: Sources["pokeemeraldWasm"]["license"],
  upstreamRepository: string,
  commit: string,
): Promise<KnowledgeRecord[]> {
  const repository = upstreamRepository.replace(/\.git$/, "");
  const source = createPokeemeraldKnowledgeSource(
    license,
    upstreamRepository,
    commit,
  );
  const [evolutionTable, evolutionScene, pokemonSource, rockSmashScript] =
    await Promise.all([
      fetchText(rawUrl(repository, commit, EVOLUTION_TABLE_PATH)),
      fetchText(rawUrl(repository, commit, EVOLUTION_SCENE_PATH)),
      fetchText(rawUrl(repository, commit, POKEMON_PATH)),
      fetchText(rawUrl(repository, commit, ROCK_SMASH_SCRIPT_PATH)),
    ]);
  validateShedinjaSource(evolutionTable, evolutionScene);
  validateWurmpleSource(evolutionTable, pokemonSource);
  validateRockSmashSource(rockSmashScript);

  return [
    {
      id: "progression:hm06-rock-smash-acquisition-emerald",
      domain: "progression",
      title: "HM06 Rock Smash acquisition in Emerald",
      aliases: [
        "HM06",
        "Rock Smash",
        "Rock Smash Dude",
        "Mauville City",
        "where to get HM06 Rock Smash",
      ],
      tags: [
        "pokemon-emerald",
        "hm06",
        "rock-smash",
        "mauville-city",
        "acquisition",
      ],
      body: [
        "In Pokémon Emerald, obtain HM06 (Rock Smash) by talking to the Rock Smash Dude in his house in Mauville City.",
        "The pinned Mauville City house event gives HM06 and records the one-time gift, so this is the actual acquisition rather than a later use mention.",
      ].join("\n"),
      sources: [
        {
          ...source,
          url: `${repository}/blob/${commit}/${ROCK_SMASH_SCRIPT_PATH}`,
        },
      ],
    },
    {
      id: "species:shedinja-creation-emerald",
      domain: "species",
      title: "Shedinja creation requirement in Emerald",
      aliases: [
        "shedinja",
        "nincada evolution",
        "empty party slot",
        "how to get shedinja",
      ],
      tags: [
        "pokemon-emerald",
        "nincada",
        "shedinja",
        "evolution",
        "level-20",
        "empty-party-slot",
      ],
      body: [
        "In Pokémon Emerald, Nincada's level-20 evolution produces Ninjask and creates Shedinja only when the party has fewer than six members.",
        "Required setup: leave at least one party slot empty before Nincada evolves.",
      ].join("\n"),
      sources: [source],
    },
    {
      id: "species:wurmple-evolution-branch-emerald",
      domain: "species",
      title: "Wurmple evolution branch in Emerald",
      aliases: [
        "wurmple",
        "silcoon",
        "cascoon",
        "wurmple evolution",
        "how to evolve wurmple",
      ],
      tags: [
        "pokemon-emerald",
        "wurmple",
        "silcoon",
        "cascoon",
        "evolution",
        "level-7",
        "personality-value",
      ],
      body: [
        "In Pokémon Emerald, Wurmple evolves at level 7. The result is Silcoon when the upper half of its hidden personality value modulo 10 is 0-4, or Cascoon when it is 5-9.",
        "The personality value is fixed when the Pokémon is created and is not shown to the player, so the branch is not a choice made at evolution time.",
      ].join("\n"),
      sources: [source],
    },
  ];
}
