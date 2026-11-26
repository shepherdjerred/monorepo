/** A pill's tone: a severity, or `neutral` for a plain category label. */
export type PillTone = "ok" | "warning" | "error" | "info" | "neutral";

/**
 * The `data-sev` a `.visual-pill` carries. A severity pill colours its glyph
 * from the shared tokens; a neutral pill is a plain chip with no severity.
 */
export function pillSeverity(
  tone: PillTone,
): Exclude<PillTone, "neutral"> | undefined {
  return tone === "neutral" ? undefined : tone;
}
