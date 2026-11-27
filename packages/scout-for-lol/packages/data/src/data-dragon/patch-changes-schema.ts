// Contract of `assets/patch-changes.generated.json`: one entry per before/after
// line of the official patch notes, parsed deterministically from the archived
// HTML by `patch-changes-parser.ts`. Regenerate with
// `bun run generate:patch-changes`; never edit the JSON by hand.

import { z } from "zod";
import { ChampionIdSchema } from "#src/model/core/identifiers.ts";
import { PatchChangeDirectionSchema } from "#src/data-dragon/patch-changes-direction.ts";

/** "RW" is LeBlanc's Mimic: Distortion, the one recast slot the notes use. */
export const PatchAbilitySlotSchema = z.enum([
  "passive",
  "Q",
  "W",
  "E",
  "R",
  "RW",
]);

export const PatchChangeSubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("champion"),
    id: ChampionIdSchema,
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal("item"),
    id: z.number().int().positive(),
    name: z.string().min(1),
  }),
]);
export type PatchChangeSubject = z.infer<typeof PatchChangeSubjectSchema>;

export const PatchChangeLineSchema = z.object({
  /** Player-facing patch number, e.g. "26.19". */
  patch: z.string().regex(/^\d+\.\d+$/),
  /** Publish date of the notes, `YYYY-MM-DD`. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  subject: PatchChangeSubjectSchema,
  /**
   * The ability heading the line sits under. `slot` is null for headings that
   * name no slot (Aphelios' weapons, an item's passive). The whole value is
   * null for base stats and for item lines with no sub-heading.
   */
  ability: z
    .object({
      slot: PatchAbilitySlotSchema.nullable(),
      name: z.string().min(1),
    })
    .nullable(),
  stat: z.string().min(1),
  before: z.string().min(1),
  after: z.string().min(1),
  /** Strength of this line alone; see `patch-changes-direction.ts`. */
  direction: PatchChangeDirectionSchema,
});
export type PatchChangeLine = z.infer<typeof PatchChangeLineSchema>;

export const PatchChangesSchema = z.array(PatchChangeLineSchema);
export type PatchChanges = z.infer<typeof PatchChangesSchema>;
