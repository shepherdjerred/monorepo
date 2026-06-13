/**
 * Turn a raw media filename (without extension) into a clean, human-friendly title. Library files
 * are typically scene/Plex-style names like `Avengers.Endgame.2019.1080p.BluRay.x264-GROUP` or
 * `Avengers - Endgame (2019) Remux - Bluray`; we strip the release junk so the queue, now-playing
 * embed, and `/stream play` matching all use `Avengers - Endgame (2019)`.
 */

/** A four-digit release year in the plausible film range (1900-2099). */
const YEAR_RE = /\b(?:19|20)\d{2}\b/gu;
/** A bracketed release year, e.g. `(2017)` or `[1999]` — the strongest signal of the real year. */
const BRACKETED_YEAR_RE = /[([]((?:19|20)\d{2})[)\]]/u;

/**
 * Release tags that mark the start of the junk suffix when there's no year to anchor on. Matched
 * case-insensitively on word boundaries; everything from the first match onward is dropped.
 */
const TAG_RE =
  /\b(?:480p|720p|1080p|2160p|4k|blu-?ray|b[rd]rip|web-?dl|webrip|hdrip|dvdrip|hdtv|remux|hdr10?|sdr|imax|x26[45]|h26[45]|hevc|avc|av1|xvid|divx|10bit|8bit|aac|ac3|dts(?:-hd)?|truehd|ddp?5[ .]1|atmos|flac|opus|proper|repack|extended|uncut|unrated|limited|internal|complete)\b/iu;

/** Trim leftover separators (dashes, dots, brackets, whitespace) from the ends of a fragment. */
function trimSeparators(value: string): string {
  return value.replace(/^[\s.\-_([]+/u, "").replace(/[\s.\-_)\]]+$/u, "");
}

/** Collapse scene-style dot/underscore separators into spaces and squeeze whitespace. */
function despace(value: string): string {
  return value.replaceAll(/[._]+/gu, " ").replaceAll(/\s+/gu, " ").trim();
}

/** The last bare four-digit year token in the string (release years trail the title), or null. */
function lastBareYear(value: string): { index: number; value: number } | null {
  let last: { index: number; value: number } | null = null;
  for (const match of value.matchAll(YEAR_RE)) {
    last = { index: match.index, value: Number(match[0]) };
  }
  return last;
}

/**
 * Extract a clean title and release year from a raw filename. If a year is present, the title is
 * everything before it (release tags trail the year); otherwise the title is everything before the
 * first recognised release tag. Returns the despaced, separator-trimmed title and the year (or null).
 */
export function parseTitleYear(raw: string): {
  title: string;
  year: number | null;
} {
  const spaced = despace(raw);

  // Prefer a bracketed year (`(2017)`) — unambiguous. Otherwise take the *last* bare year token, so a
  // year that's part of the title (`Blade Runner 2049 2017`) doesn't get mistaken for the release year.
  const bracketed = BRACKETED_YEAR_RE.exec(spaced);
  const yearMatch =
    bracketed === null
      ? lastBareYear(spaced)
      : { index: bracketed.index, value: Number(bracketed[1]) };

  if (yearMatch !== null) {
    const title = trimSeparators(spaced.slice(0, yearMatch.index));
    // A year at the very start (`2001 A Space Odyssey`) is part of the title, not a release year —
    // keep the whole thing and report no year.
    if (title.length > 0) {
      return { title, year: yearMatch.value };
    }
    return { title: trimSeparators(spaced), year: null };
  }

  const tagMatch = TAG_RE.exec(spaced);
  if (tagMatch !== null && tagMatch.index > 0) {
    return {
      title: trimSeparators(spaced.slice(0, tagMatch.index)),
      year: null,
    };
  }

  return { title: trimSeparators(spaced), year: null };
}

/** Format a raw filename as a clean display title: `Title (Year)`, or just `Title` when no year. */
export function normalizeTitle(raw: string): string {
  const { title, year } = parseTitleYear(raw);
  if (title.length === 0) {
    // Degenerate input (empty / all separators) — fall back to the despaced original, then the raw
    // trimmed input, so we never surface an empty title.
    const despaced = despace(raw);
    return despaced.length > 0 ? despaced : raw.trim();
  }
  return year === null ? title : `${title} (${String(year)})`;
}
