import type { GameFactPart } from "#src/domain/tooltips/game-fact-types.ts";

export type DescriptionSegment =
  | { type: "text"; text: string }
  | { type: "keyword"; text: string; part: GameFactPart };

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Splits a description around the first mention of each keyword part. A
 * mention is the keyword's name at a word start, taking its inflection with
 * it, so "Charm" finds "Charms" and "Charmed". A keyword the text never
 * mentions is returned in `unmentioned` for the caller to list on its own.
 */
export function splitKeywords(
  text: string,
  keywords: readonly GameFactPart[],
): { segments: DescriptionSegment[]; unmentioned: GameFactPart[] } {
  const found: { start: number; end: number; part: GameFactPart }[] = [];
  const unmentioned: GameFactPart[] = [];

  for (const part of keywords) {
    const match = new RegExp(
      String.raw`\b${escapeRegExp(part.name)}\w*`,
      "i",
    ).exec(text);
    if (match === null) {
      unmentioned.push(part);
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    const overlaps = found.some(
      (other) => start < other.end && other.start < end,
    );
    if (overlaps) unmentioned.push(part);
    else found.push({ start, end, part });
  }

  found.sort((a, b) => a.start - b.start);
  const segments: DescriptionSegment[] = [];
  let cursor = 0;
  for (const hit of found) {
    if (hit.start > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, hit.start) });
    }
    segments.push({
      type: "keyword",
      text: text.slice(hit.start, hit.end),
      part: hit.part,
    });
    cursor = hit.end;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor) });
  }
  return { segments, unmentioned };
}

/**
 * An item's passives arrive as one string ("Scorn: ... Hatefog: ..."). Each
 * named passive becomes its own paragraph so the name can stand out.
 */
export function splitPassives(
  text: string,
): { name: string | undefined; text: string }[] {
  const pieces = text.split(/(?<=[.!?])\s+(?=[A-Z][A-Za-z' ]{1,24}:\s)/);
  return pieces.map((piece) => {
    const named = /^([A-Z][A-Za-z' ]{1,24}):\s/.exec(piece);
    return named === null
      ? { name: undefined, text: piece }
      : { name: named[1], text: piece.slice(named[0].length) };
  });
}
