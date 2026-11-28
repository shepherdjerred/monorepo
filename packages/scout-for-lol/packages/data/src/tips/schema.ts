import { z } from "zod";
import { AbilitySlotSchema } from "#src/data-dragon/ability-facts.ts";
import {
  ChampionIdSchema,
  RuneIdSchema,
  SummonerSpellIdSchema,
} from "#src/model/core/identifiers.ts";
import { type Lane, LaneSchema } from "#src/model/riot/lane.ts";

/**
 * Generated tips: short, grounded advice written ahead of time by a model and
 * never by users. Two kinds exist: matchup tips for an ordered
 * (champion, opponent, lane) pair and general tips per (champion, lane), plus
 * short keyword glossary entries for tooltips.
 *
 * On disk, beside this module (written by the generator, read by `load.ts`):
 *
 * ```
 * generated/matchup/<lane>/<ChampionKey>.json   every opponent of one champion in one lane
 * generated/general/<lane>.json                 every champion's general tips in one lane
 * generated/glossary.json                       keyword glossary
 * ```
 *
 * `<lane>` is a {@link Lane} and `<ChampionKey>` is the Data Dragon key
 * (`MonkeyKing`, `LeeSin`). Every set carries the hash of the grounding facts
 * it was written from, so a set whose facts changed is detected as stale.
 */

export const TIP_FILE_SCHEMA_VERSION = 1;

export const TIP_TEXT_MAX_LENGTH = 160;
export const GLOSSARY_DEFINITION_MAX_LENGTH = 200;
export const MATCHUP_TIPS_MIN = 1;
export const MATCHUP_TIPS_MAX = 3;
export const GENERAL_TIPS_MIN = 3;
export const GENERAL_TIPS_MAX = 6;

/** Lowercase slug naming a glossary keyword, e.g. `charmed`. */
export const GlossaryIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .brand<"GlossaryId">();
export type GlossaryId = z.infer<typeof GlossaryIdSchema>;

/**
 * A fact a tip leans on. Ability cites drive the ability icons beside a tip;
 * `abilityNumber` grounds every number the text states; keyword cites attach
 * glossary tooltips.
 */
export const CiteSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ability"),
    champion: ChampionIdSchema,
    slot: AbilitySlotSchema,
    name: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("abilityNumber"),
    champion: ChampionIdSchema,
    slot: AbilitySlotSchema,
    /** A `dataValues` key of the ability facts, or `cooldown`, `cost` or `range`. */
    field: z.string().min(1),
    values: z.array(z.number()).min(1),
  }),
  z.strictObject({
    kind: z.literal("item"),
    id: z.number().int().positive(),
    name: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("spell"),
    id: SummonerSpellIdSchema,
    name: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("rune"),
    id: RuneIdSchema,
    name: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("keyword"),
    id: GlossaryIdSchema,
  }),
]);
export type Cite = z.infer<typeof CiteSchema>;
export type AbilityCite = Extract<Cite, { kind: "ability" }>;
export type AbilityNumberCite = Extract<Cite, { kind: "abilityNumber" }>;

export const TipSchema = z.strictObject({
  text: z.string().trim().min(1).max(TIP_TEXT_MAX_LENGTH),
  cites: z.array(CiteSchema),
});
export type Tip = z.infer<typeof TipSchema>;

const InputHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const GenerationStampSchema = z.strictObject({
  /** SHA-256 of `promptVersion` and the grounding facts; see `input-hash.ts`. */
  inputHash: InputHashSchema,
  promptVersion: z.string().min(1),
  model: z.string().min(1),
});

export const MatchupTipSetSchema = z
  .strictObject({
    lane: LaneSchema,
    /** The champion the tips are written for. */
    champion: ChampionIdSchema,
    opponent: ChampionIdSchema,
    tips: z.array(TipSchema).min(MATCHUP_TIPS_MIN).max(MATCHUP_TIPS_MAX),
  })
  .extend(GenerationStampSchema.shape)
  .refine((set) => set.champion !== set.opponent, {
    error: "a matchup tip set needs two different champions",
  });
export type MatchupTipSet = z.infer<typeof MatchupTipSetSchema>;

export const GeneralTipSetSchema = z
  .strictObject({
    lane: LaneSchema,
    champion: ChampionIdSchema,
    tips: z.array(TipSchema).min(GENERAL_TIPS_MIN).max(GENERAL_TIPS_MAX),
  })
  .extend(GenerationStampSchema.shape);
export type GeneralTipSet = z.infer<typeof GeneralTipSetSchema>;

export const GlossaryEntrySchema = z.strictObject({
  id: GlossaryIdSchema,
  /** Display form, e.g. `Charmed`. */
  term: z.string().trim().min(1),
  /** Other forms the tooltip attaches to, e.g. `charm`, `charms`. */
  aliases: z.array(z.string().trim().min(1)),
  definition: z.string().trim().min(1).max(GLOSSARY_DEFINITION_MAX_LENGTH),
  cites: z.array(CiteSchema),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;

function duplicates<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const repeated = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated];
}

/** `generated/matchup/<lane>/<ChampionKey>.json`: one champion's opponents in one lane. */
export const MatchupTipFileSchema = z
  .strictObject({
    schemaVersion: z.literal(TIP_FILE_SCHEMA_VERSION),
    lane: LaneSchema,
    champion: ChampionIdSchema,
    sets: z.array(MatchupTipSetSchema),
  })
  .superRefine((file, context) => {
    for (const [index, set] of file.sets.entries()) {
      if (set.lane !== file.lane || set.champion !== file.champion) {
        context.addIssue({
          code: "custom",
          path: ["sets", index],
          message: "set lane and champion must match the file",
        });
      }
    }
    const repeated = duplicates(file.sets.map((set) => set.opponent));
    if (repeated.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["sets"],
        message: `opponents appear more than once: ${repeated.join(", ")}`,
      });
    }
  });
export type MatchupTipFile = z.infer<typeof MatchupTipFileSchema>;

/** `generated/general/<lane>.json`: every champion's general tips in one lane. */
export const GeneralTipFileSchema = z
  .strictObject({
    schemaVersion: z.literal(TIP_FILE_SCHEMA_VERSION),
    lane: LaneSchema,
    sets: z.array(GeneralTipSetSchema),
  })
  .superRefine((file, context) => {
    for (const [index, set] of file.sets.entries()) {
      if (set.lane !== file.lane) {
        context.addIssue({
          code: "custom",
          path: ["sets", index, "lane"],
          message: "set lane must match the file",
        });
      }
    }
    const repeated = duplicates(file.sets.map((set) => set.champion));
    if (repeated.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["sets"],
        message: `champions appear more than once: ${repeated.join(", ")}`,
      });
    }
  });
export type GeneralTipFile = z.infer<typeof GeneralTipFileSchema>;

/** `generated/glossary.json`. */
export const GlossaryFileSchema = z
  .strictObject({
    schemaVersion: z.literal(TIP_FILE_SCHEMA_VERSION),
    entries: z.array(GlossaryEntrySchema),
  })
  .superRefine((file, context) => {
    const repeated = duplicates(file.entries.map((entry) => entry.id));
    if (repeated.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: `glossary ids appear more than once: ${repeated.join(", ")}`,
      });
    }
  });
export type GlossaryFile = z.infer<typeof GlossaryFileSchema>;

/** Paths relative to the `generated/` directory. */
export function matchupTipFilePath(lane: Lane, championKey: string): string {
  return `matchup/${lane}/${championKey}.json`;
}

export function generalTipFilePath(lane: Lane): string {
  return `general/${lane}.json`;
}

export const GLOSSARY_FILE_PATH = "glossary.json";
