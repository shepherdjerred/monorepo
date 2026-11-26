import { beforeAll, describe, expect, test } from "vitest";
import { SummonerSpellIdSchema } from "#src/model/core/identifiers.ts";
import {
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import type { Tip } from "#src/tips/schema.ts";
import {
  AHRI,
  CHARMED,
  CHARMED_ID,
  CHARM_SLOW,
  SYNDRA,
  ability,
  ahriMidGeneralSet,
  ahriSyndraMidSets,
} from "#src/tips/tips.fixture.ts";
import {
  type TipIssueCode,
  type TipValidationContext,
  validateGeneralTipSet,
  validateGlossaryEntry,
  validateMatchupPair,
  validateTip,
} from "#src/tips/validate.ts";
import { tipSimilarity } from "#src/tips/validate-text.ts";

const HASH = "b".repeat(64);
const TELEPORT = SummonerSpellIdSchema.parse(12);

let matchup: TipValidationContext;
let ahriOnly: TipValidationContext;

beforeAll(async () => {
  const [ahri, syndra, abilityIndex] = await Promise.all([
    loadChampionGrounding(AHRI),
    loadChampionGrounding(SYNDRA),
    loadAbilityNameIndex(),
  ]);
  const glossary = new Map([[CHARMED_ID, CHARMED]]);
  matchup = { champions: [ahri, syndra], abilityIndex, glossary };
  ahriOnly = { champions: [ahri], abilityIndex, glossary };
});

function codes(tip: Tip, context = matchup): TipIssueCode[] {
  return validateTip(tip, context).map((issue) => issue.code);
}

describe("the round-5 example tips", () => {
  test("pass with their cites", () => {
    const { forward, reverse } = ahriSyndraMidSets(HASH);
    const general = ahriMidGeneralSet(HASH);
    expect(validateGeneralTipSet(general, ahriOnly)).toEqual([]);
    expect(
      validateMatchupPair({ forward, reverse, general: [general] }, matchup),
    ).toEqual([]);
  });

  test("fail when a named ability is not cited", () => {
    expect(
      codes({
        text: "Poke with Dark Sphere whenever she walks up to last-hit.",
        cites: [],
      }),
    ).toEqual(["uncited-ability"]);
  });

  test("fail with a wrong ability name in a cite", () => {
    expect(
      codes({
        text: "Poke with Dark Sphere whenever she walks up to last-hit.",
        cites: [ability(SYNDRA, "Q", "Dark Orb")],
      }),
    ).toEqual(["bad-cite"]);
  });

  test("fail with another champion's ability in the text", () => {
    expect(
      codes({
        text: "Hold your stun for when she casts Mystic Shot.",
        cites: [],
      }),
    ).toEqual(["foreign-ability"]);
  });

  test("fail when a cite names a champion outside the matchup", () => {
    expect(
      codes(
        {
          text: "Poke with Dark Sphere whenever she walks up to last-hit.",
          cites: [ability(SYNDRA, "Q", "Dark Sphere")],
        },
        ahriOnly,
      ),
    ).toEqual(["bad-cite", "foreign-ability"]);
  });

  test("fail with an uncited number and pass when the number is cited", () => {
    expect(
      codes({
        text: "Charm lasts 2 seconds, so walk up only when it is down.",
        cites: [ability(AHRI, "E", "Charm")],
      }),
    ).toEqual(["uncited-number"]);
    expect(
      codes({
        text: "At max rank Charm holds you for 1.8 seconds; stay behind minions.",
        cites: [
          ability(AHRI, "E", "Charm"),
          {
            kind: "abilityNumber",
            champion: AHRI,
            slot: "E",
            field: "CharmDuration",
            values: [1.8],
          },
        ],
      }),
    ).toEqual([]);
    expect(
      codes({
        text: "Charm is down for 12 seconds after a miss.",
        cites: [
          ability(AHRI, "E", "Charm"),
          {
            kind: "abilityNumber",
            champion: AHRI,
            slot: "E",
            field: "cooldown",
            values: [9],
          },
        ],
      }),
    ).toEqual(["uncited-number", "bad-cite"]);
  });
});

describe("percentages, statistics, copy rules and pairs", () => {
  test("pass with a percentage that is a cited ability value", () => {
    expect(
      codes({
        text: "Charm slows them by 65%, so walk them into your Fox-Fire.",
        cites: [
          ability(AHRI, "E", "Charm"),
          ability(AHRI, "W", "Fox-Fire"),
          CHARM_SLOW,
        ],
      }),
    ).toEqual([]);
    expect(
      codes({
        text: "Charm slows them by 65 percent.",
        cites: [ability(AHRI, "E", "Charm"), CHARM_SLOW],
      }),
    ).toEqual([]);
  });

  test("fail with a percentage that is not a cited ability value", () => {
    expect(
      codes({
        text: "Charm slows them by 65%.",
        cites: [ability(AHRI, "E", "Charm")],
      }),
    ).toEqual(["statistic"]);
    expect(
      codes({
        text: "Charm slows them by 50%.",
        cites: [ability(AHRI, "E", "Charm"), CHARM_SLOW],
      }),
    ).toEqual(["statistic"]);
  });

  test("fail with a percentage or other statistic", () => {
    expect(
      codes({
        text: "Syndra wins 52% of these lanes, so play safe.",
        cites: [],
      }),
    ).toEqual(["statistic"]);
    expect(
      codes({ text: "Play for the percent chance she misses.", cites: [] }),
    ).toEqual(["statistic"]);
    expect(
      codes({ text: "She loses most games after a lost lane.", cites: [] }),
    ).toEqual(["statistic"]);
    expect(
      codes({ text: "Her win rate drops when she falls behind.", cites: [] }),
    ).toEqual(["statistic"]);
  });

  test("fail with an explanatory lead-in", () => {
    expect(
      codes({
        text: "Remember to hold your stun for the moment she dashes in.",
        cites: [],
      }),
    ).toEqual(["lead-in"]);
    expect(
      codes({
        text: "Poke early. Here’s the key: she has no escape without Spirit Rush.",
        cites: [ability(AHRI, "R", "Spirit Rush")],
      }),
    ).toEqual(["lead-in"]);
  });

  test("fail with more than two sentences", () => {
    expect(
      codes({ text: "Push. Roam. Repeat after every wave.", cites: [] }),
    ).toEqual(["sentences"]);
  });

  test("keywords must exist and appear in the text", () => {
    expect(
      codes({
        text: "Fight only once she is charmed.",
        cites: [{ kind: "keyword", id: CHARMED_ID }],
      }),
    ).toEqual([]);
    expect(
      codes({
        text: "Fight only once she is stunned.",
        cites: [{ kind: "keyword", id: CHARMED_ID }],
      }),
    ).toEqual(["bad-cite"]);
  });

  test("spells, items and runes must match Data Dragon", () => {
    expect(
      codes({
        text: "Take Teleport and farm until level 6.",
        cites: [{ kind: "spell", id: TELEPORT, name: "Teleport" }],
      }),
    ).toEqual([]);
    expect(
      codes({
        text: "Take Ignite and fight at level 2.",
        cites: [{ kind: "spell", id: TELEPORT, name: "Ignite" }],
      }),
    ).toEqual(["bad-cite"]);
  });

  test("near-duplicates across directions are reported", () => {
    const { forward, reverse } = ahriSyndraMidSets(HASH);
    const echoed = {
      ...reverse,
      tips: [
        ...reverse.tips.slice(0, 2),
        {
          text: "Syndra out-ranges you early. Give up a minion, not a free Dark Sphere.",
          cites: [ability(SYNDRA, "Q", "Dark Sphere")],
        },
      ],
    };
    const issues = validateMatchupPair({ forward, reverse: echoed }, matchup);
    expect(issues.map((issue) => issue.code)).toEqual(["near-duplicate"]);
    expect(
      tipSimilarity(
        "Hold your stun for the moment she dashes in.",
        "Stand behind your minions so Charm cannot reach you.",
      ),
    ).toBeLessThan(0.3);
  });

  test("a pair whose sets are not one unit is reported", () => {
    const { forward, reverse } = ahriSyndraMidSets(HASH);
    expect(
      validateMatchupPair(
        { forward, reverse: { ...reverse, inputHash: "c".repeat(64) } },
        matchup,
      ).map((issue) => issue.code),
    ).toEqual(["set"]);
  });

  test("glossary definitions follow the same rules", () => {
    // The definition's 65% is Charm's cited SlowPercent.
    expect(validateGlossaryEntry(CHARMED, matchup)).toEqual([]);
    expect(
      validateGlossaryEntry(
        { ...CHARMED, cites: [ability(AHRI, "E", "Charm")] },
        matchup,
      ).map((issue) => issue.code),
    ).toEqual(["statistic"]);
    expect(
      validateGlossaryEntry(
        {
          ...CHARMED,
          definition:
            "Note that charmed units walk toward the caster, slowed by 65%.",
        },
        matchup,
      ).map((issue) => issue.code),
    ).toEqual(["lead-in"]);
  });
});
