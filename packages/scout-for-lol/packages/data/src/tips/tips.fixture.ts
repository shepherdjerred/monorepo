import type { AbilitySlot } from "#src/data-dragon/ability-facts.ts";
import {
  type ChampionId,
  ChampionIdSchema,
} from "#src/model/core/identifiers.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import {
  type Cite,
  type GeneralTipSet,
  type GlossaryEntry,
  GlossaryIdSchema,
  type MatchupTipSet,
  type Tip,
} from "#src/tips/schema.ts";

/**
 * The approved example tips from the round-5 design brief: Ahri in Mid, and
 * Ahri into Syndra from both sides, with the ability icons the mockups show.
 */

export const AHRI = ChampionIdSchema.parse(103);
export const SYNDRA = ChampionIdSchema.parse(134);

export function ability(
  champion: ChampionId,
  slot: AbilitySlot,
  name: string,
): Cite {
  return { kind: "ability", champion, slot, name };
}

export const CHARMED_ID = GlossaryIdSchema.parse("charmed");

export const CHARMED: GlossaryEntry = {
  id: CHARMED_ID,
  term: "Charmed",
  aliases: ["charm", "charms"],
  definition: "Walks helplessly toward the caster and cannot attack or cast.",
  cites: [ability(AHRI, "E", "Charm")],
};

export const AHRI_MID_GENERAL_TIPS: Tip[] = [
  {
    text: "Land Charm before you commit; everything else hits harder on a charmed target.",
    cites: [ability(AHRI, "E", "Charm"), { kind: "keyword", id: CHARMED_ID }],
  },
  {
    text: "Keep one Spirit Rush dash to get out, not only to get in.",
    cites: [ability(AHRI, "R", "Spirit Rush")],
  },
  {
    text: "After level 6, push the wave and visit a side lane; Ahri is one of the best roamers in mid.",
    cites: [],
  },
];

export const AHRI_INTO_SYNDRA_TIPS: Tip[] = [
  {
    text: "Syndra out-ranges you early. Give up a minion rather than take a free Dark Sphere.",
    cites: [ability(SYNDRA, "Q", "Dark Sphere")],
  },
  {
    text: "Her stun is her only defence. Bait it out, then Charm.",
    cites: [
      ability(SYNDRA, "E", "Scatter the Weak"),
      ability(AHRI, "E", "Charm"),
    ],
  },
  {
    text: "From level 6, dash sideways through her spheres; if she misses the stun, you win the fight.",
    cites: [ability(AHRI, "R", "Spirit Rush")],
  },
];

export const SYNDRA_INTO_AHRI_TIPS: Tip[] = [
  {
    text: "Poke with Dark Sphere whenever she walks up to last-hit.",
    cites: [ability(SYNDRA, "Q", "Dark Sphere")],
  },
  {
    text: "Hold your stun for the moment she dashes in. Do not spend it on poke.",
    cites: [ability(SYNDRA, "E", "Scatter the Weak")],
  },
  {
    text: "Stand behind your minions so Charm cannot reach you.",
    cites: [ability(AHRI, "E", "Charm")],
  },
];

export const FIXTURE_PROMPT_VERSION = "tips-fixture-1";
export const FIXTURE_MODEL = "fixture-model";

export function ahriMidGeneralSet(inputHash: string): GeneralTipSet {
  return {
    lane: "middle",
    champion: AHRI,
    tips: AHRI_MID_GENERAL_TIPS,
    inputHash,
    promptVersion: FIXTURE_PROMPT_VERSION,
    model: FIXTURE_MODEL,
  };
}

export function ahriSyndraMidSets(inputHash: string): {
  forward: MatchupTipSet;
  reverse: MatchupTipSet;
} {
  const lane: Lane = "middle";
  const stamp = {
    lane,
    inputHash,
    promptVersion: FIXTURE_PROMPT_VERSION,
    model: FIXTURE_MODEL,
  };
  return {
    forward: {
      ...stamp,
      champion: AHRI,
      opponent: SYNDRA,
      tips: AHRI_INTO_SYNDRA_TIPS,
    },
    reverse: {
      ...stamp,
      champion: SYNDRA,
      opponent: AHRI,
      tips: SYNDRA_INTO_AHRI_TIPS,
    },
  };
}
