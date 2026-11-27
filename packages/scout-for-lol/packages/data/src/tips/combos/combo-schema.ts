import { z } from "zod";
import { ChampionIdSchema } from "#src/model/core/identifiers.ts";

/**
 * Combos, tricks, rotations and terrain spots of a champion in a lane: only the
 * well-known ones a player of that champion would recognise. A champion with a
 * simple kit has none (an empty list is the expected answer), so a general set
 * carries 0 to {@link COMBOS_MAX}. A step is data the UI renders as an icon: an
 * ability slot of the champion, a basic attack, a summoner spell or an item.
 */

export const COMBOS_MAX = 8;
/** A matchup side may point at this many of its champion's combos. */
export const COMBO_REFS_MAX = 3;
export const COMBO_TEXT_MAX_LENGTH = 160;
export const COMBO_NAME_MAX_LENGTH = 40;
export const COMBO_STEPS_MAX = 12;

/** Terrain is a wall hop or a dash-over spot; the others are about the order of casts. */
export const COMBO_CATEGORIES = [
  "combo",
  "trick",
  "rotation",
  "terrain",
] as const;
export const ComboCategorySchema = z.enum(COMBO_CATEGORIES);
export type ComboCategory = z.infer<typeof ComboCategorySchema>;

export const ComboSlotSchema = z.enum(["P", "Q", "W", "E", "R"]);
export type ComboSlot = z.infer<typeof ComboSlotSchema>;

export const ComboStepSchema = z.union([
  z.literal("attack"),
  z.strictObject({
    kind: z.literal("ability"),
    champion: ChampionIdSchema,
    slot: ComboSlotSchema,
  }),
  z.strictObject({
    kind: z.literal("spell"),
    id: z.number().int().positive(),
    name: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("item"),
    id: z.number().int().positive(),
    name: z.string().min(1),
  }),
]);
export type ComboStep = z.infer<typeof ComboStepSchema>;

export const ComboSchema = z.strictObject({
  /** Stable within a set and across regenerations of the same set's combos. */
  id: z.string().min(1),
  /** Short, for example "Charm catch". */
  name: z.string().trim().min(1).max(COMBO_NAME_MAX_LENGTH),
  category: ComboCategorySchema,
  sequence: z.array(ComboStepSchema).max(COMBO_STEPS_MAX),
  /** One plain sentence: the situation to use it. */
  when: z.string().trim().min(1).max(COMBO_TEXT_MAX_LENGTH),
  /** One or two plain sentences: how and why. A terrain spot is named in plain words, no coordinates. */
  text: z.string().trim().min(1).max(COMBO_TEXT_MAX_LENGTH),
});
export type Combo = z.infer<typeof ComboSchema>;

export const ComboRefSchema = z.strictObject({
  comboId: z.string().min(1),
  /** One line on why it works or fails in this matchup. */
  note: z.string().trim().min(1).max(COMBO_TEXT_MAX_LENGTH),
});
export type ComboRef = z.infer<typeof ComboRefSchema>;
