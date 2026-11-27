import { z } from "zod";
import {
  AbilitySlotSchema,
  type AbilityFacts,
  type AbilityMechanics,
} from "#src/data-dragon/ability-facts.ts";
import { laneToString, type Lane } from "#src/model/riot/lane.ts";
import type { ChampionGrounding } from "#src/tips/grounding.ts";
import { describePatchChange } from "#src/tips/patch-context.ts";
import {
  GENERAL_TIPS_MAX,
  GENERAL_TIPS_MIN,
  GLOSSARY_DEFINITION_MAX_LENGTH,
  type GlossaryEntry,
  type GlossaryId,
  MATCHUP_TIPS_MAX,
  MATCHUP_TIPS_MIN,
  TIP_TEXT_MAX_LENGTH,
} from "#src/tips/schema.ts";
import type { TipIssue } from "#src/tips/validate.ts";

/**
 * The tip-writing prompt. Bump {@link TIP_PROMPT_VERSION} whenever the system
 * text, the grounding layout or the output shape changes: it is part of every
 * set's input hash, so a new version makes every earlier set regenerate.
 *
 * The system text is fixed and comes first, so any provider-side prefix
 * caching applies to everything but the per-unit facts that follow it.
 */
export const TIP_PROMPT_VERSION = "tips-4";

/**
 * The structural shape the model must return. Deliberately loose (no length,
 * count or catalog limits): the validators own those rules and feed their
 * findings back, which a schema failure cannot do precisely.
 */
const DraftCiteSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ability"),
    champion: z.number().int(),
    slot: AbilitySlotSchema,
    name: z.string(),
  }),
  z.object({ kind: z.literal("keyword"), id: z.string() }),
]);

/**
 * The sources a tip can rest on, as the generator and the judges name them:
 * the ability numbers and descriptions, the CommunityDragon mechanics, the
 * recent patch changes, Riot's own tips, the wiki notes given up front, a wiki
 * page looked up, or none of them.
 */
export const TIP_SOURCES = [
  "ability-facts",
  "mechanics",
  "patch-changes",
  "riot-tips",
  "wiki-notes",
  "wiki-lookup",
  "general-knowledge",
] as const;
export const TipSourceSchema = z.enum(TIP_SOURCES);
export type TipSource = z.infer<typeof TipSourceSchema>;

/**
 * Source labels from a model, keeping the ones this list names. The draft
 * schema takes plain strings (an enum on every tip made Anthropic's structured
 * output grammar too large), and a label is report metadata, so an unknown one
 * is dropped rather than failing the unit.
 */
export function knownSources(labels: readonly string[]): TipSource[] {
  return labels.flatMap((label) => {
    const parsed = TipSourceSchema.safeParse(label);
    return parsed.success ? [parsed.data] : [];
  });
}

export const DraftTipSchema = z.object({
  text: z.string(),
  cites: z.array(DraftCiteSchema),
  /** The sources this tip rests on; reported by the eval, not stored with the tip. */
  basis: z.array(z.string()),
});

const DraftGlossaryEntrySchema = z.object({
  id: z.string(),
  term: z.string(),
  aliases: z.array(z.string()),
  definition: z.string(),
});

export const MatchupDraftSchema = z.object({
  /** Tips for the player of the first champion, against the second. */
  forward: z.array(DraftTipSchema),
  /** Tips for the player of the second champion, against the first. */
  reverse: z.array(DraftTipSchema),
  /** Glossary entries for keywords the tips cite that are not listed yet. */
  glossary: z.array(DraftGlossaryEntrySchema),
});
export type MatchupDraft = z.infer<typeof MatchupDraftSchema>;

export const GeneralDraftSchema = z.object({
  tips: z.array(DraftTipSchema),
  glossary: z.array(DraftGlossaryEntrySchema),
});
export type GeneralDraft = z.infer<typeof GeneralDraftSchema>;

export const MATCHUP_SCHEMA_NAME = "scout_matchup_tips";
export const GENERAL_SCHEMA_NAME = "scout_general_tips";

const SYSTEM_RULES = `You write short advice for Scout, a League of Legends site for casual players. A player reads your tips beside the champion they are about to play. Tips are written ahead of time and read by many people, so every tip has to be true for any game of that champion in that lane.

Voice
- A tip is one or two short sentences, at most ${TIP_TEXT_MAX_LENGTH.toString()} characters. It tells the player what to do or avoid, and when. Concrete, never vague.
- Plain words a casual player understands. Name abilities by their real names (given in the facts), never as Q, W, E or R. Spell the champion's name or say "he", "she", "they".
- Address the player directly. In a matchup the player plays the first champion named for that direction; the other is "the enemy" or their name.
- Never cite statistics: no percentages, win rates, pick rates, game counts or odds. Avoid numbers altogether; a level ("level 6") is fine.
- Never explain a tip, introduce it, or comment on it. Do not open with "Remember", "Keep in mind", "Here is", "It is important", "In this matchup" or "That is". Start with the advice itself.
- Do not recommend items, runes or summoner spells.
- State only what the facts and the wiki notes support. Never invent what an ability does or how it interacts with minions, terrain or other abilities. When you cannot confirm a claim, leave it out.
- Each tip says something different. Do not repeat a tip, or its idea, across the two directions or within a set.

Sources
- Each ability line carries its numbers, its resolved description and, from CommunityDragon, its aiming and missile mechanics (width, speed, whether a missile ends at the first unit it hits). A champion's recent patch changes are listed, so use the current values and never describe a number a patch has since changed.

Looking things up
- Each champion's ability notes from the official League of Legends Wiki follow the facts. They say what an ability hits or passes through, what blocks it, and how it behaves in edge cases, which the facts omit.
- The "lookup" tool reads any other page of that wiki by title: an item, a status such as "Slow" or "Airborne", a mechanic, or a champion not given here. Call it before you write a tip that depends on something you are unsure of, such as how a projectile treats minions or what a status does. It is slow; do not call it for what the notes already say.

Cites
- Every ability you name gets one cite in that tip: {"kind":"ability","champion":<champion id>,"slot":"passive"|"Q"|"W"|"E"|"R","name":"<exact ability name>"}. Cite each ability once per tip. Copy the name exactly as the facts give it; a champion whose ability has two forms lists both, for example "Cocoon / Rappel", and the cite carries the whole string.
- Name only abilities of the champions you are given. Never name another champion's ability.
- Cite only what the tip names. A tip that names no ability has "cites": [].
- Do not state numbers in a tip (a level, as in "level 6", is fine); say "short cooldown" or "long range" instead.
- A game term a casual player may not know (for example slowed, silenced, executed, poke) is a keyword: the word appears in the text and the tip carries {"kind":"keyword","id":"<glossary id>"}. Reuse an id from the glossary list when it is there. When it is not and a tooltip would help, add an entry to "glossary" and cite it. Name a status by its -ed form (slowed, stunned, silenced) so one tooltip covers it. Use keywords sparingly, only for terms that need a tooltip.
- A glossary entry is {"id":"lowercase-slug","term":"Display form","aliases":["other","forms"],"definition":"..."}. The definition is one or two plain sentences, at most ${GLOSSARY_DEFINITION_MAX_LENGTH.toString()} characters, without statistics. The term or an alias must appear in the tip's text. A definition explains the term for any champion: never name a champion or an ability in it.

Output
- Return one JSON object that matches the requested schema, and nothing else.
- Matchup: "forward" has ${MATCHUP_TIPS_MIN.toString()} to ${MATCHUP_TIPS_MAX.toString()} tips for the player of the first champion against the second, "reverse" has ${MATCHUP_TIPS_MIN.toString()} to ${MATCHUP_TIPS_MAX.toString()} tips for the player of the second champion against the first. The two sides describe one lane, so they must agree with each other.
- General: "tips" has ${GENERAL_TIPS_MIN.toString()} to ${GENERAL_TIPS_MAX.toString()} tips for playing the champion in the lane, whoever the opponent is.
- Write as many tips as the facts truly support, up to the maximum: every distinct, true, non-overlapping thing a player of that champion should know in that situation. A rich matchup earns many tips; a thin one earns few. Never pad to reach a number: no repeats in other words, no obvious advice, no claim you cannot confirm. Cover different abilities, phases of the lane and situations rather than one idea several times. Every tip stays one or two plain sentences.
- Every tip carries "basis": the sources it rests on, from "ability-facts" (the numbers and descriptions), "mechanics" (the CommunityDragon aiming and missile data), "patch-changes" (the recent changes), "riot-tips", "wiki-notes" (the notes given up front), "wiki-lookup" (a page you looked up), and "general-knowledge" (nothing given supports it). List every source that supports the tip, honestly.
- "glossary" holds only entries for keywords your tips cite that are not already listed; otherwise it is [].`;

/** One worked example for the system text. Other champions, so no unit is copied. */
type ExampleTip = {
  text: string;
  cites: readonly object[];
  basis: readonly string[];
};

const RENEKTON = 58;
const NASUS = 75;

const abilityCite = (champion: number, slot: string, name: string) => ({
  kind: "ability",
  champion,
  slot,
  name,
});

export const EXAMPLE_GLOSSARY: GlossaryEntrySeed = {
  id: "slowed",
  term: "Slowed",
  aliases: ["slow", "slows"],
  definition: "Moves more slowly for a short time.",
};

type GlossaryEntrySeed = {
  id: string;
  term: string;
  aliases: string[];
  definition: string;
};

export const EXAMPLE_MATCHUP = {
  lane: "top",
  championIds: [RENEKTON, NASUS],
  forward: [
    {
      text: "Stun him with Ruthless Predator when he walks up to last-hit, then leave.",
      cites: [abilityCite(RENEKTON, "W", "Ruthless Predator")],
      basis: ["wiki-notes"],
    },
    {
      text: "Fight early, before Siphoning Strike has made him hit hard.",
      cites: [abilityCite(NASUS, "Q", "Siphoning Strike")],
      basis: ["ability-facts"],
    },
    {
      text: "Dash back out with Slice and Dice as soon as you have traded.",
      cites: [abilityCite(RENEKTON, "E", "Slice and Dice")],
      basis: ["ability-facts"],
    },
  ],
  reverse: [
    {
      text: "Put Wither on him as he dashes in; it blunts his trade.",
      cites: [abilityCite(NASUS, "W", "Wither")],
      basis: ["ability-facts", "wiki-notes"],
    },
    {
      text: "Back off when his Fury is full, because Ruthless Predator then stuns for longer.",
      cites: [abilityCite(RENEKTON, "W", "Ruthless Predator")],
      basis: ["ability-facts"],
    },
    {
      text: "Use Spirit Fire on him before you trade; it cuts his Armor.",
      cites: [abilityCite(NASUS, "E", "Spirit Fire")],
      basis: ["ability-facts"],
    },
  ],
  glossary: [],
} satisfies {
  lane: string;
  championIds: number[];
  forward: ExampleTip[];
  reverse: ExampleTip[];
  glossary: GlossaryEntrySeed[];
};

export const EXAMPLE_GENERAL = {
  lane: "top",
  championIds: [NASUS],
  tips: [
    {
      text: "Last-hit with Siphoning Strike every time; each kill makes it hit harder.",
      cites: [abilityCite(NASUS, "Q", "Siphoning Strike")],
      basis: ["ability-facts"],
    },
    {
      text: "Save Wither for whoever runs at you; it leaves them slowed and cuts their Attack Speed.",
      cites: [
        abilityCite(NASUS, "W", "Wither"),
        { kind: "keyword", id: "slowed" },
      ],
      basis: ["ability-facts"],
    },
    {
      text: "Wait for Fury of the Sands before a big fight; Nasus is far sturdier while it lasts.",
      cites: [abilityCite(NASUS, "R", "Fury of the Sands")],
      basis: ["ability-facts"],
    },
  ],
  glossary: [EXAMPLE_GLOSSARY],
} satisfies {
  lane: string;
  championIds: number[];
  tips: ExampleTip[];
  glossary: GlossaryEntrySeed[];
};

export const TIP_SYSTEM_PROMPT = `${SYSTEM_RULES}

Example of the voice, matchup (Renekton is the first champion, Nasus the second, in Top):
${JSON.stringify({ forward: EXAMPLE_MATCHUP.forward, reverse: EXAMPLE_MATCHUP.reverse, glossary: EXAMPLE_MATCHUP.glossary })}

Example of the voice, general (Nasus in Top):
${JSON.stringify({ tips: EXAMPLE_GENERAL.tips, glossary: EXAMPLE_GENERAL.glossary })}

Those examples are only a guide to style. Write fresh tips for the champions you are given.`;

function joinRanks(values: readonly number[]): string {
  const first = values[0];
  if (first === undefined) {
    return "none";
  }
  return values.every((value) => value === first)
    ? first.toString()
    : values.map((value) => value.toString()).join("/");
}

function describeMissile(
  missile: AbilityMechanics["missiles"][number],
): string {
  const speed =
    missile.speed === null
      ? undefined
      : missile.minSpeed === null || missile.maxSpeed === null
        ? `speed ${missile.speed.toString()}`
        : `speed ${missile.speed.toString()} (accelerates between ${missile.minSpeed.toString()} and ${missile.maxSpeed.toString()})`;
  return [
    `missile ${missile.name}`,
    missile.width === null ? undefined : `width ${missile.width.toString()}`,
    speed,
    missile.tracksTarget ? "follows its target" : undefined,
    missile.stopsOnFirstHit
      ? "ends at the first unit it hits"
      : "has no end-on-hit behavior, so it keeps going after a hit",
  ]
    .filter((part) => part !== undefined)
    .join(", ");
}

/** The CommunityDragon aiming and missile data, as one prompt line (or none). */
export function describeMechanics(
  mechanics: AbilityMechanics | undefined,
): string {
  if (mechanics === undefined) {
    return "";
  }
  const parts = [
    mechanics.targeting === null
      ? undefined
      : `aimed as ${mechanics.targeting}`,
    mechanics.castTime === null
      ? undefined
      : `cast time ${mechanics.castTime.toString()}s`,
    mechanics.radius === null
      ? undefined
      : `radius ${mechanics.radius.toString()}`,
    mechanics.lineWidth === null
      ? undefined
      : `line width ${mechanics.lineWidth.toString()}`,
    ...mechanics.missiles.map((missile) => describeMissile(missile)),
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? "" : ` Mechanics: ${parts.join("; ")}.`;
}

function describeAbility(slot: string, ability: AbilityFacts): string {
  const numbers =
    ability.cooldownByRank.length === 0
      ? ""
      : ` Cooldown ${joinRanks(ability.cooldownByRank)} seconds by rank; cost ${joinRanks(ability.costByRank)} ${ability.costType}; range ${joinRanks(ability.rangeByRank)}.`;
  const description = ability.resolvedDescription.replaceAll(
    /\{\{[^}]*\}\}/gu,
    "[X]",
  );
  return `- ${slot} "${ability.name}":${numbers} ${description}${describeMechanics(ability.mechanics)}`;
}

function bulletSection(title: string, entries: readonly string[]): string[] {
  return entries.length === 0
    ? []
    : [title, ...entries.map((entry) => `- ${entry}`)];
}

export function describeChampion(
  label: string,
  grounding: ChampionGrounding,
  wikiNotes?: string,
): string {
  const abilities = Object.entries(grounding.facts.abilities).map(
    ([slot, facts]) => describeAbility(slot, facts),
  );
  return [
    `## ${label}: ${grounding.name} (champion id ${grounding.championId.toString()})`,
    `Roles: ${grounding.tags.join(", ")}`,
    "Abilities:",
    ...abilities,
    ...bulletSection(
      `Riot's tips for playing ${grounding.name}:`,
      grounding.allytips,
    ),
    ...bulletSection(
      `Riot's tips for playing against ${grounding.name}:`,
      grounding.enemytips,
    ),
    ...(grounding.recentChanges.length === 0
      ? []
      : [
          `${grounding.name}'s changes in the recent patches (newest first; the current values are the "after" side):`,
          ...grounding.recentChanges.map(
            (line) => `- ${describePatchChange(line)}`,
          ),
        ]),
    ...(wikiNotes === undefined
      ? []
      : [
          `League of Legends Wiki ability notes for ${grounding.name}:`,
          wikiNotes,
        ]),
  ].join("\n");
}

function describeGlossary(
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>,
): string {
  if (glossary.size === 0) {
    return "Glossary list: empty.";
  }
  const lines = [...glossary.values()]
    .toSorted((left, right) => (left.id < right.id ? -1 : 1))
    .map(
      (entry) =>
        `- ${entry.id}: ${entry.term}${entry.aliases.length === 0 ? "" : ` (also ${entry.aliases.join(", ")})`}`,
    );
  return ["Glossary list (cite by id):", ...lines].join("\n");
}

/**
 * A prompt in two parts. `prefix` holds what units of the same champion share
 * (the glossary and that champion's block), so a batch can mark it as a cache
 * breakpoint and pay for it once; `rest` is the unit's own part. `prompt` is
 * the two joined, for callers that send one string.
 */
export type TipPrompt = {
  system: string;
  prefix: string;
  rest: string;
  prompt: string;
};

function twoParts(system: string, prefix: string, rest: string): TipPrompt {
  return { system, prefix, rest, prompt: `${prefix}\n\n${rest}` };
}

export function buildMatchupPrompt(input: {
  lane: Lane;
  first: ChampionGrounding;
  second: ChampionGrounding;
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>;
  /** Wiki ability notes of the first and second champion. */
  notes?: readonly [string, string] | undefined;
  /** Which champion's block is the shared prefix; the first by default. */
  anchor?: "first" | "second" | undefined;
}): TipPrompt {
  const firstBlock = describeChampion(
    "Champion",
    input.first,
    input.notes?.[0],
  );
  const secondBlock = describeChampion(
    "Champion",
    input.second,
    input.notes?.[1],
  );
  const [anchorBlock, otherBlock] =
    input.anchor === "second"
      ? [secondBlock, firstBlock]
      : [firstBlock, secondBlock];
  return twoParts(
    TIP_SYSTEM_PROMPT,
    [describeGlossary(input.glossary), "", anchorBlock].join("\n"),
    [
      otherBlock,
      "",
      `Write matchup tips for ${laneToString(input.lane)} lane: ${input.first.name} against ${input.second.name}.`,
      `"forward" is for the player of ${input.first.name}; "reverse" is for the player of ${input.second.name}.`,
    ].join("\n"),
  );
}

export function buildGeneralPrompt(input: {
  lane: Lane;
  champion: ChampionGrounding;
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>;
  notes?: string | undefined;
}): TipPrompt {
  return twoParts(
    TIP_SYSTEM_PROMPT,
    [
      describeGlossary(input.glossary),
      "",
      describeChampion("Champion", input.champion, input.notes),
    ].join("\n"),
    `Write general tips for playing ${input.champion.name} in ${laneToString(input.lane)} lane.`,
  );
}

const MAX_FEEDBACK_ISSUES = 12;

/**
 * The retry prompt: the original request, the rejected answer, and the
 * validator's findings, so the model repairs exactly what failed.
 */
export function buildRetryPrompt(input: {
  prompt: string;
  /** The rejected answer, or undefined when there was none to show. */
  rejected: unknown;
  issues: readonly TipIssue[];
}): string {
  const listed = input.issues
    .slice(0, MAX_FEEDBACK_ISSUES)
    .map((issue) =>
      issue.tip === undefined
        ? `- ${issue.message}`
        : `- "${issue.tip}": ${issue.message}`,
    );
  return [
    input.prompt,
    "",
    ...(input.rejected === undefined
      ? ["Your previous answer was rejected."]
      : ["Your previous answer was rejected:", JSON.stringify(input.rejected)]),
    "",
    "Problems found:",
    ...listed,
    "",
    "Return a complete corrected object. Change only what the problems require.",
  ].join("\n");
}
