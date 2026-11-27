import { beforeAll, describe, expect, test } from "vitest";
import {
  checkGeneralDraft,
  type UnitEnvironment,
} from "#src/tips/check-draft.ts";
import { fakeTipModel } from "#src/tips/fake-model.fixture.ts";
import {
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import {
  EXAMPLE_GENERAL,
  GeneralDraftSchema,
  TIP_PROMPT_VERSION,
} from "#src/tips/prompt.ts";
import type { GlossaryEntry, GlossaryId } from "#src/tips/schema.ts";
import { ChampionIdSchema } from "#src/model/core/identifiers.ts";

const NASUS = ChampionIdSchema.parse(75);
const HASH = "e".repeat(64);

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

describe("keyword cites the text does not contain", () => {
  test("are dropped, and the unit is accepted", async () => {
    const nasus = await loadChampionGrounding(NASUS);
    // The example's second tip says "slowed"; its text loses the word here.
    const tips = EXAMPLE_GENERAL.tips.map((tip, index) =>
      index === 1
        ? {
            ...tip,
            text: "Save Wither for whoever runs at you; it cuts their Attack Speed.",
          }
        : tip,
    );
    const checked = checkGeneralDraft({
      env,
      lane: "top",
      grounding: nasus,
      inputHash: HASH,
      draft: GeneralDraftSchema.parse({
        tips,
        glossary: EXAMPLE_GENERAL.glossary,
      }),
    });
    expect(checked.issues).toEqual([]);
    expect(checked.result?.set.tips[1]?.cites).toEqual([
      { kind: "ability", champion: NASUS, slot: "W", name: "Wither" },
    ]);
    // The proposal nothing cites any more is not added to the glossary.
    expect(checked.result?.glossaryAdditions).toEqual([]);
  });

  test("still fail when the keyword is not in the glossary at all", async () => {
    const nasus = await loadChampionGrounding(NASUS);
    const tips = EXAMPLE_GENERAL.tips.map((tip, index) =>
      index === 1
        ? { ...tip, cites: [...tip.cites, { kind: "keyword", id: "missing" }] }
        : tip,
    );
    const checked = checkGeneralDraft({
      env,
      lane: "top",
      grounding: nasus,
      inputHash: HASH,
      draft: GeneralDraftSchema.parse({
        tips,
        glossary: EXAMPLE_GENERAL.glossary,
      }),
    });
    expect(checked.issues.map((issue) => issue.code)).toContain("bad-cite");
  });
});
