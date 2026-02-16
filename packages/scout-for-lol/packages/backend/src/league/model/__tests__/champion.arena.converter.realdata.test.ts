import { describe, it, expect } from "bun:test";
import { z } from "zod";
// Types from @scout-for-lol/data are used by TypeScript for type checking
import { participantToArenaChampion } from "@scout-for-lol/backend/league/model/champion.ts";

import type { RawParticipant } from "@scout-for-lol/data/index";

const currentDir = import.meta.dirname;

const RAW_FILE_PATHS = [
  `${currentDir}/testdata/matches_2025_09_19_NA1_5370969615.json`,
  `${currentDir}/testdata/matches_2025_09_19_NA1_5370986469.json`,
];

async function loadParticipants(path: string): Promise<RawParticipant[]> {
  const file = Bun.file(path);

  const json = await file.json();
  return json.info.participants;
}

describe("participantToArenaChampion with real arena JSON", () => {
  it("extracts augments (non-zero) and maps metrics", async () => {
    for (const path of RAW_FILE_PATHS) {
      const participants = await loadParticipants(path);
      for (const dto of participants) {
        const champ = await participantToArenaChampion(dto);
        // all augments non-zero (for id-only fallback and full augment objects)
        expect(champ.augments.every((a) => (z.object({ id: z.number() }).safeParse(a).success ? a.id : 0) !== 0)).toBe(
          true,
        );
        // at most 6
        expect(champ.augments.length).toBeLessThanOrEqual(6);
        // base fields present
        expect(z.string().safeParse(champ.championName).success).toBe(true);
        expect(z.number().safeParse(champ.level).success).toBe(true);
        // metrics present as numbers or undefined
        expect(z.number().safeParse(champ.teamSupport.damageShieldedOnTeammate).success).toBe(true);
        expect(z.number().safeParse(champ.teamSupport.healsOnTeammate).success).toBe(true);
      }
    }
  });
});
