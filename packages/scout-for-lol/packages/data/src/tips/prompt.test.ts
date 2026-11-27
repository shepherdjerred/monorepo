import { beforeAll, describe, expect, test } from "vitest";
import {
  checkGeneralDraft,
  checkMatchupDraft,
  type UnitEnvironment,
} from "#src/tips/check-draft.ts";
import { fakeTipModel } from "#src/tips/fake-model.fixture.ts";
import {
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import {
  EXAMPLE_GENERAL,
  EXAMPLE_MATCHUP,
  GeneralDraftSchema,
  MatchupDraftSchema,
  TIP_PROMPT_VERSION,
  TIP_SYSTEM_PROMPT,
  buildGeneralPrompt,
  buildMatchupPrompt,
  buildRetryPrompt,
} from "#src/tips/prompt.ts";
import { ChampionIdSchema } from "#src/model/core/identifiers.ts";
import { AHRI, CHARMED, CHARMED_ID, SYNDRA } from "#src/tips/tips.fixture.ts";
import type { GlossaryEntry, GlossaryId } from "#src/tips/schema.ts";

const RENEKTON = ChampionIdSchema.parse(EXAMPLE_MATCHUP.championIds[0]);
const NASUS = ChampionIdSchema.parse(EXAMPLE_MATCHUP.championIds[1]);
const HASH = "d".repeat(64);

let env: UnitEnvironment;

beforeAll(async () => {
  env = {
    model: fakeTipModel(() => ({})),
    promptVersion: TIP_PROMPT_VERSION,
    abilityIndex: await loadAbilityNameIndex(),
    glossary: new Map<GlossaryId, GlossaryEntry>(),
    maxOutputTokens: 1000,
  };
});

describe("the worked examples in the system prompt", () => {
  test("pass the same validators the generator applies", async () => {
    const [renekton, nasus] = await Promise.all([
      loadChampionGrounding(RENEKTON),
      loadChampionGrounding(NASUS),
    ]);
    const matchup = checkMatchupDraft({
      env,
      lane: "top",
      groundings: [renekton, nasus],
      inputHash: HASH,
      draft: MatchupDraftSchema.parse({
        forward: EXAMPLE_MATCHUP.forward,
        reverse: EXAMPLE_MATCHUP.reverse,
        glossary: EXAMPLE_MATCHUP.glossary,
      }),
    });
    expect(matchup.issues).toEqual([]);

    const general = checkGeneralDraft({
      env,
      lane: "top",
      grounding: nasus,
      inputHash: HASH,
      draft: GeneralDraftSchema.parse({
        tips: EXAMPLE_GENERAL.tips,
        glossary: EXAMPLE_GENERAL.glossary,
      }),
    });
    expect(general.issues).toEqual([]);
    expect(general.result?.glossaryAdditions.map((entry) => entry.id)).toEqual([
      "slowed",
    ]);
  });

  test("are for champions no pilot or eval unit needs to copy", () => {
    expect(TIP_SYSTEM_PROMPT).toContain("Nasus");
    expect(TIP_SYSTEM_PROMPT).not.toContain("Ahri");
  });
});

describe("the unit prompt", () => {
  test("carries both champions' abilities, tags and Riot's tips, and no statistics", async () => {
    const [ahri, syndra] = await Promise.all([
      loadChampionGrounding(AHRI),
      loadChampionGrounding(SYNDRA),
    ]);
    const { system, prompt } = buildMatchupPrompt({
      lane: "middle",
      first: ahri,
      second: syndra,
      glossary: new Map([[CHARMED_ID, CHARMED]]),
    });
    expect(system).toBe(TIP_SYSTEM_PROMPT);
    for (const name of [
      "Orb of Deception",
      "Fox-Fire",
      "Charm",
      "Spirit Rush",
      "Dark Sphere",
      "Scatter the Weak",
      "Unleashed Power",
    ]) {
      expect(prompt).toContain(`"${name}"`);
    }
    expect(prompt).toContain("champion id 103");
    expect(prompt).toContain("champion id 134");
    expect(prompt).toContain("Mid lane");
    expect(prompt).toMatch(/Cooldown [\d./]+ seconds by rank/u);
    expect(prompt).toContain("Riot's tips for playing against Ahri");
    expect(prompt).toContain("- charmed: Charmed (also charm, charms)");
    expect(prompt).not.toMatch(/win ?rate|pick ?rate|games played/iu);
    expect(prompt).not.toContain("{{");
  });

  test("keeps the fixed system text first so the per-unit facts are the only variable part", async () => {
    const ahri = await loadChampionGrounding(AHRI);
    const general = buildGeneralPrompt({
      lane: "middle",
      champion: ahri,
      glossary: new Map<GlossaryId, GlossaryEntry>(),
    });
    expect(general.system).toBe(TIP_SYSTEM_PROMPT);
    expect(general.prompt).toContain("Write general tips for playing Ahri");
    expect(general.prompt).toContain("Glossary list: empty.");
  });

  test("the retry prompt repeats the request, the rejected answer and the findings", () => {
    const retry = buildRetryPrompt({
      prompt: "REQUEST",
      rejected: { forward: [] },
      issues: [{ code: "statistic", message: "cites a win rate", tip: "T" }],
    });
    expect(retry.startsWith("REQUEST")).toBe(true);
    expect(retry).toContain('{"forward":[]}');
    expect(retry).toContain('- "T": cites a win rate');
  });
});
