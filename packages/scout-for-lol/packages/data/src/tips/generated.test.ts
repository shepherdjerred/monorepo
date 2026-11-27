import { readdir } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { ChampionIdSchema } from "#src/model/core/identifiers.ts";
import { LANE_ORDER } from "#src/model/riot/lane.ts";
import {
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import { isTipSetStaleAgainstCurrentFacts } from "#src/tips/input-hash.ts";
import {
  GlossaryFileSchema,
  type MatchupTipSet,
  GeneralTipFileSchema,
  MatchupTipFileSchema,
  generalTipFilePath,
} from "#src/tips/schema.ts";
import {
  validateGeneralTipSet,
  validateGlossaryEntry,
  validateMatchupPair,
} from "#src/tips/validate.ts";

const GENERATED = `${import.meta.dir}/generated`;

async function readJson(path: string): Promise<unknown> {
  const value: unknown = await Bun.file(`${GENERATED}/${path}`).json();
  return value;
}

function matchupKey(lane: string, champion: number, opponent: number): string {
  return `${lane}:${champion.toString()}:${opponent.toString()}`;
}

async function matchupFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const lane of LANE_ORDER) {
    const names = await readdir(`${GENERATED}/matchup/${lane}`).catch(() => []);
    files.push(...names.map((name) => `matchup/${lane}/${name}`));
  }
  return files;
}

describe("the committed generated tips", () => {
  test("every set is current and passes the validators", async () => {
    const abilityIndex = await loadAbilityNameIndex();
    const glossaryFile = GlossaryFileSchema.parse(
      await readJson("glossary.json"),
    );
    const glossary = new Map(
      glossaryFile.entries.map((entry) => [entry.id, entry]),
    );

    const matchups = new Map<string, MatchupTipSet>();
    for (const path of await matchupFiles()) {
      for (const set of MatchupTipFileSchema.parse(await readJson(path)).sets) {
        expect(await isTipSetStaleAgainstCurrentFacts(set), path).toBe(false);
        matchups.set(matchupKey(set.lane, set.champion, set.opponent), set);
      }
    }
    expect(matchups.size).toBeGreaterThan(0);

    const generalSets = [];
    for (const lane of LANE_ORDER) {
      if (await Bun.file(`${GENERATED}/${generalTipFilePath(lane)}`).exists()) {
        const raw = await readJson(generalTipFilePath(lane));
        generalSets.push(...GeneralTipFileSchema.parse(raw).sets);
      }
    }

    for (const set of generalSets) {
      expect(await isTipSetStaleAgainstCurrentFacts(set)).toBe(false);
      const champion = await loadChampionGrounding(set.champion);
      expect(
        validateGeneralTipSet(set, {
          champions: [champion],
          abilityIndex,
          glossary,
        }),
        `${champion.name} ${set.lane}`,
      ).toEqual([]);
    }

    for (const set of matchups.values()) {
      const reverse = matchups.get(
        matchupKey(set.lane, set.opponent, set.champion),
      );
      expect(
        reverse,
        `${set.champion.toString()} vs ${set.opponent.toString()}`,
      ).toBeDefined();
      if (reverse === undefined || set.champion > set.opponent) {
        continue;
      }
      const [first, second] = await Promise.all([
        loadChampionGrounding(set.champion),
        loadChampionGrounding(set.opponent),
      ]);
      expect(
        validateMatchupPair(
          {
            forward: set,
            reverse,
            general: generalSets.filter(
              (general) =>
                general.lane === set.lane &&
                (general.champion === set.champion ||
                  general.champion === set.opponent),
            ),
          },
          { champions: [first, second], abilityIndex, glossary },
        ),
        `${first.name} vs ${second.name}`,
      ).toEqual([]);
    }

    for (const entry of glossaryFile.entries) {
      expect(
        validateGlossaryEntry(entry, {
          champions: [await loadChampionGrounding(ChampionIdSchema.parse(103))],
          abilityIndex,
          glossary,
        }),
        entry.id,
      ).toEqual([]);
    }
  });
});
