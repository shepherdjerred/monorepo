import { z } from "zod";

/**
 * Which way a champion faces in a splash image, so two champions can face each
 * other on one page. The image bytes never change; presentation code mirrors
 * them at runtime from this metadata (`splashPresentation` in
 * `#src/browser-assets.ts`).
 *
 * `facing` is the direction the champion's face and body point, as the viewer
 * sees the image: `left` points toward the image's left edge.
 */
export const SplashFacingSchema = z.enum(["left", "right", "center"]);
export type SplashFacing = z.infer<typeof SplashFacingSchema>;

export const SplashFacingSourceSchema = z.enum(["model", "human"]);

// Plain prose only: structured output occasionally appends a stray brace.
const NoteSchema = z
  .string()
  .max(240)
  .regex(/^[^{}]*$/, "note must be plain text without braces");

export const ChampionSplashFacingEntrySchema = z.object({
  facing: SplashFacingSchema,
  /** Horizontal position of the champion's face, 0 (left edge) to 1 (right). */
  focusX: z.number().min(0).max(1),
  /**
   * False when mirroring would read wrong: visible text or a logo, or an
   * asymmetric feature that is part of the champion's identity.
   */
  mirrorSafe: z.boolean(),
  /** SHA-256 of the splash bytes this entry describes. */
  imageSha256: z.string().regex(/^[\da-f]{64}$/),
  source: SplashFacingSourceSchema,
  /** How sure the classifier was; `low` entries are worth a human look. */
  confidence: z.enum(["low", "medium", "high"]),
  /** Why, when the call was not obvious (empty when it was). */
  note: NoteSchema,
});
export type ChampionSplashFacingEntry = z.infer<
  typeof ChampionSplashFacingEntrySchema
>;

/** Keys are splash file names, for example `Ahri_0.jpg`. */
export const ChampionSplashFacingSchema = z.object({
  version: z.literal(1),
  entries: z.record(
    z.string().regex(/^[\w-]+_0\.jpg$/),
    ChampionSplashFacingEntrySchema,
  ),
});
export type ChampionSplashFacing = z.infer<typeof ChampionSplashFacingSchema>;

/** The fields the vision model fills in for one image. */
export const SplashFacingClassificationSchema = z.object({
  facing: SplashFacingSchema,
  focusX: z.number().min(0).max(1),
  mirrorSafe: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
  note: NoteSchema,
});
export type SplashFacingClassification = z.infer<
  typeof SplashFacingClassificationSchema
>;
