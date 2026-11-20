import type { ReactNode } from "react";

const GLYPHS: Record<string, string> = {
  succeeded: "✓",
  verified: "✓",
  failed: "✕",
  running: "◐",
  pending: "○",
  queued: "○",
  awaiting_approval: "⏸",
  canceled: "⊘",
  not_started: "–",
  unknown: "?",
  watching: "◔",
  settled: "✓",
  alarmed: "!",
  unmonitored: "–",
  granted: "✓",
  rejected: "✕",
  expired: "◌",
};

export function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

/**
 * Status as glyph, words, and color, so no channel carries it alone. `value`
 * picks the glyph and the color; `label` replaces the words when a page has
 * its own for that state, such as a commit's "Deployed" or "CI failed".
 */
export function Status({ value, label }: { value: string; label?: ReactNode }) {
  return (
    <span className={`status status-${value}`}>
      <span className="status-glyph" aria-hidden="true">
        {GLYPHS[value] ?? "•"}
      </span>
      <span className="status-label">{label ?? statusLabel(value)}</span>
    </span>
  );
}
