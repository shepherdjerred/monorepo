import { z } from "zod";

/**
 * One card Scout Desktop's in-game overlay may show.
 *
 * The language-neutral source of truth is `overlay-card.schema.json`; the
 * shared accept and reject bodies live in `overlay-card.fixtures.json`. The
 * Rust overlay holds the same fixtures to strict serde types in
 * `desktop/crates/scout-overlay/src/card.rs`, and
 * `overlay-card.schema.test.ts` fails if this file and the JSON Schema drift.
 */

export const OVERLAY_CARD_KINDS = [
  "pregame_plan",
  "answer",
  "status",
  "proactive",
  "review_ready",
] as const;

export const OverlayCardKindSchema = z.enum(OVERLAY_CARD_KINDS);
export type OverlayCardKind = z.infer<typeof OverlayCardKindSchema>;

export const OverlayCardPrioritySchema = z.enum(["low", "normal", "high"]);

export const OverlayCardSchema = z.strictObject({
  id: z.string().min(1).max(64),
  kind: OverlayCardKindSchema,
  title: z.string().min(1).max(80),
  lines: z.array(z.string().min(1).max(160)).min(1).max(5),
  priority: OverlayCardPrioritySchema,
  ttlSecs: z.number().int().min(1).max(600),
});
export type OverlayCard = z.infer<typeof OverlayCardSchema>;
