import type { ScoutQlSpan } from "#src/model/scoutql/diagnostics.ts";

// ── Span surgery ─────────────────────────────────────────────────────────────
// The time controls rewrite a QUERY, not a plan, and the query is the user's
// text: their comments, their spacing, their clause they hand-tuned. So every
// change is expressed as a minimal edit against source offsets, and everything
// outside the edited span survives byte for byte.

export type ScoutQlEdit = { start: number; end: number; newText: string };

/**
 * Apply edits back-to-front so earlier offsets stay valid. Overlapping edits
 * are a bug in the caller, not a case to resolve — they would silently produce
 * text nobody asked for, so they throw.
 */
export function applyScoutQlEdits(text: string, edits: ScoutQlEdit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let out = text;
  let previousStart = text.length + 1;
  for (const edit of ordered) {
    if (edit.end > previousStart) {
      throw new Error(
        `ScoutQL time-spec edits overlap at ${String(edit.start)}..${String(edit.end)}.`,
      );
    }
    out = out.slice(0, edit.start) + edit.newText + out.slice(edit.end);
    previousStart = edit.start;
  }
  return out;
}

/**
 * Delete one member of a comma-separated list, taking exactly one separator
 * with it (the preceding comma, or the following one for the first member).
 * Returns undefined for a single-member list, where the caller has to delete
 * the whole clause instead.
 */
export function listItemDeletion(
  items: readonly ScoutQlSpan[],
  index: number,
): ScoutQlEdit | undefined {
  const target = items[index];
  if (target === undefined || items.length <= 1) {
    return undefined;
  }
  const previous = items[index - 1];
  if (previous !== undefined) {
    return { start: previous.end, end: target.end, newText: "" };
  }
  const next = items[index + 1];
  return next === undefined
    ? undefined
    : { start: target.start, end: next.start, newText: "" };
}

/** Extend a deletion backwards over the whitespace that preceded the clause. */
export function withLeadingWhitespace(
  text: string,
  edit: ScoutQlEdit,
): ScoutQlEdit {
  let start = edit.start;
  while (start > 0 && /\s/u.test(text[start - 1] ?? "")) {
    start -= 1;
  }
  return { ...edit, start };
}

/**
 * Whether the clause that follows an offset starts its own line. A query
 * written one-clause-per-line keeps that shape when a clause is inserted.
 */
export function clauseSeparator(text: string, anchor: number): string {
  return text.startsWith("\n", anchor) ? "\n" : " ";
}
