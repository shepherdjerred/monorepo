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
};

export function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

/** Status as glyph, words, and color, so no channel carries it alone. */
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <span className="status-glyph" aria-hidden="true">
        {GLYPHS[value] ?? "•"}
      </span>
      <span className="status-label">{statusLabel(value)}</span>
    </span>
  );
}
