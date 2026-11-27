import { beforeAll, describe, expect, test } from "vitest";
import { getChampionIdByName } from "#src/model/riot/champion-registry.ts";
import { NAME_PLACEHOLDER, maskAbilityNames } from "#src/tips/ability-names.ts";
import {
  type ChampionGrounding,
  type AbilityNameIndex,
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import type { Cite, GlossaryEntry, GlossaryId } from "#src/tips/schema.ts";
import {
  type TipValidationContext,
  addMissingAbilityCites,
  validateTip,
} from "#src/tips/validate.ts";

let index: AbilityNameIndex;
const groundings = new Map<string, ChampionGrounding>();

async function champion(name: string): Promise<ChampionGrounding> {
  const known = groundings.get(name);
  if (known !== undefined) {
    return known;
  }
  const id = getChampionIdByName(name);
  if (id === undefined) {
    throw new Error(`no champion ${name}`);
  }
  const grounding = await loadChampionGrounding(id);
  groundings.set(name, grounding);
  return grounding;
}

function context(grounding: ChampionGrounding): TipValidationContext {
  return {
    champions: [grounding],
    abilityIndex: index,
    glossary: new Map<GlossaryId, GlossaryEntry>(),
  };
}

/** The cite for an ability by its official name, found in the facts and not typed by hand. */
function citeOf(grounding: ChampionGrounding, name: string): Cite {
  const slot = (["passive", "Q", "W", "E", "R"] as const).find(
    (candidate) => grounding.facts.abilities[candidate].name === name,
  );
  if (slot === undefined) {
    throw new Error(`${grounding.name} has no ability ${name}`);
  }
  return { kind: "ability", champion: grounding.championId, slot, name };
}

beforeAll(async () => {
  index = await loadAbilityNameIndex();
});

describe("official ability names", () => {
  test("are one plain word while a text is counted, wherever the name comes from", () => {
    const masked = maskAbilityNames(
      "Take off with Flap, Flap, Flap to escape. Then Watch Out! Eep! the enemy.",
      index,
    );
    expect(masked.text).toBe(
      `Take off with ${NAME_PLACEHOLDER} to escape. Then ${NAME_PLACEHOLDER} the enemy.`,
    );
    expect(masked.names).toBe(2);
    expect(masked.nameCharacters).toBe(
      "Flap, Flap, Flap".length + "Watch Out! Eep!".length,
    );
  });

  test("with punctuation do not count as extra sentences (Smolder's Flap, Flap, Flap)", async () => {
    const smolder = await champion("Smolder");
    const text =
      "Take off with Flap, Flap, Flap to escape or to cross walls. It ends if you cast another ability or get hit by hard crowd control.";
    const issues = validateTip(
      { text, cites: [citeOf(smolder, "Flap, Flap, Flap")] },
      context(smolder),
    );
    expect(issues.map((issue) => issue.code)).not.toContain("sentences");
  });

  test("with an exclamation mark do not split a sentence (Lillia's Watch Out! Eep!)", async () => {
    const lillia = await champion("Lillia");
    const issues = validateTip(
      {
        text: "Aim Watch Out! Eep! so the enemy stands in the center of the strike; that sweet spot deals far more damage than the edge.",
        cites: [citeOf(lillia, "Watch Out! Eep!")],
      },
      context(lillia),
    );
    expect(issues).toEqual([]);
  });

  test("of a champion with two forms count by either form alone (Jayce's To the Skies!)", async () => {
    const jayce = await champion("Jayce");
    const issues = validateTip(
      {
        text: "Land To the Skies! on the enemy, then step back before the fight starts.",
        cites: [citeOf(jayce, "To the Skies! / Shock Blast")],
      },
      context(jayce),
    );
    expect(issues.map((issue) => issue.code)).not.toContain("sentences");
  });

  test("and a champion's own name with a period are one word too (Dr. Mundo)", () => {
    expect(
      maskAbilityNames(
        "Stay out of range of Dr. Mundo until he spends it.",
        index,
      ).text,
    ).toBe(`Stay out of range of ${NAME_PLACEHOLDER} until he spends it.`);
  });

  test("with a number are not an uncited number (Caitlyn's 90 Caliber Net)", async () => {
    const caitlyn = await champion("Caitlyn");
    const issues = validateTip(
      {
        text: "Fire 90 Caliber Net away from the enemy to escape or to hop over a wall. It also slows whoever it hits.",
        cites: [citeOf(caitlyn, "90 Caliber Net")],
      },
      context(caitlyn),
    );
    expect(issues.map((issue) => issue.code)).not.toContain("uncited-number");
    // A number outside a name is still held to the cites.
    expect(
      validateTip(
        {
          text: "Fire 90 Caliber Net and wait 7 seconds.",
          cites: [citeOf(caitlyn, "90 Caliber Net")],
        },
        context(caitlyn),
      ).map((issue) => issue.code),
    ).toContain("uncited-number");
  });

  test("are left out of the length limit, and the words around them are not", async () => {
    const smolder = await champion("Smolder");
    const cites = [citeOf(smolder, "Flap, Flap, Flap")];
    const longTip = {
      text: `Take off with Flap, Flap, Flap to escape or to cross walls. It ends if you cast another ability or get hit by hard crowd control, so use it before you are caught.`,
      cites,
    };
    expect(longTip.text.length).toBeGreaterThan(160);
    expect(
      validateTip(longTip, context(smolder)).map((issue) => issue.code),
    ).not.toContain("length");
    const tooLong = {
      text: `${longTip.text} Then keep moving until the danger has passed and you are safe again.`,
      cites,
    };
    expect(
      validateTip(tooLong, context(smolder)).map((issue) => issue.code),
    ).toContain("length");
  });
});

describe("a champion's passive named in a tip", () => {
  test("is cited for the tip when the text names it (Caitlyn's Headshot)", async () => {
    const caitlyn = await champion("Caitlyn");
    const tip = {
      text: "Attack a rooted enemy so you can hit them with a bonus Headshot from long range.",
      cites: [],
    };
    expect(
      validateTip(tip, context(caitlyn)).map((issue) => issue.code),
    ).toContain("uncited-ability");
    const [fixed] = addMissingAbilityCites([tip], context(caitlyn));
    expect(fixed?.cites).toEqual([citeOf(caitlyn, "Headshot")]);
    expect(validateTip(fixed ?? tip, context(caitlyn))).toEqual([]);
  });

  test("keeps the cites a tip has, and adds nothing for another champion's ability", async () => {
    const caitlyn = await champion("Caitlyn");
    const named = citeOf(caitlyn, "Headshot");
    const [same] = addMissingAbilityCites(
      [{ text: "Use Headshot after the trap.", cites: [named] }],
      context(caitlyn),
    );
    expect(same?.cites).toEqual([named]);
    const [other] = addMissingAbilityCites(
      [{ text: "Dodge the stun and Flap, Flap, Flap away.", cites: [] }],
      context(caitlyn),
    );
    expect(other?.cites).toEqual([]);
  });
});
