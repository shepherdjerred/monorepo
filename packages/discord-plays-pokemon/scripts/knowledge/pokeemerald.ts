import { fetchText } from "./fetch.ts";
import {
  type KnowledgeRecord,
  type KnowledgeSource,
  type Sources,
} from "./model.ts";

const EVOLUTION_TABLE_PATH = "src/data/pokemon/evolution.h";
const EVOLUTION_SCENE_PATH = "src/evolution_scene.c";

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
  const [evolutionTable, evolutionScene] = await Promise.all([
    fetchText(rawUrl(repository, commit, EVOLUTION_TABLE_PATH)),
    fetchText(rawUrl(repository, commit, EVOLUTION_SCENE_PATH)),
  ]);
  validateShedinjaSource(evolutionTable, evolutionScene);

  return [
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
  ];
}
