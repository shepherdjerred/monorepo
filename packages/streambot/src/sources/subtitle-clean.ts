/**
 * Pure, zero-I/O cleaner for YouTube **auto-generated** caption files. YouTube auto-captions use a
 * "rolling" format where every spoken phrase is emitted several times — built up word-by-word, then a
 * tiny (~10 ms) "finalization" cue, then carried as the top line while the next phrase builds on the
 * bottom. `yt-dlp --convert-subs srt` strips the inline word/`<c>` tags but KEEPS those duplicated,
 * overlapping cues, so libass burns a doubled, stale, sometimes-reversed two-line scroll. This module
 * detects that signature and collapses it to clean, non-overlapping **single-line** cues (each phrase
 * shown once, from when it's first spoken until the next), leaving already-clean tracks untouched.
 *
 * Operates on the SRT yt-dlp already produces (the exact bytes that get burned), so the wire-in in
 * {@link file://./subtitle-io.ts} needs no yt-dlp arg change. Everything here is deterministic and
 * unit-testable with no filesystem access.
 */

/** A parsed SRT cue: millisecond bounds and its (markup-stripped) text lines, top to bottom. */
export type SrtCue = {
  readonly startMs: number;
  readonly endMs: number;
  readonly lines: string[];
};

/** Cues at or below this duration are treated as YouTube "finalization" duplicates (~10 ms in practice). */
const SHORT_CUE_MS = 200;

/** Compare each cue's lines against the last N emitted lines — the size of YouTube's visible window. */
const VISIBLE_WINDOW = 2;

const SRT_TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/u;
const SRT_TIMING_LINE =
  /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/u;

/** Parse one `HH:MM:SS,mmm` (or `.mmm`) stamp to milliseconds; null if it doesn't match. */
function timeToMs(stamp: string): number | null {
  const m = SRT_TIME.exec(stamp);
  if (m === null) return null;
  const [, h, min, s, ms] = m;
  if (
    h === undefined ||
    min === undefined ||
    s === undefined ||
    ms === undefined
  ) {
    return null;
  }
  // Right-pad fractional part to milliseconds (`,5` → 500ms, `,05` → 50ms).
  const millis = Number(ms.padEnd(3, "0"));
  return (
    Number(h) * 3_600_000 + Number(min) * 60_000 + Number(s) * 1000 + millis
  );
}

/** Format milliseconds as an SRT `HH:MM:SS,mmm` timestamp. */
function msToSrtTime(ms: number): string {
  const clamped = Math.max(0, Math.trunc(ms));
  const h = Math.trunc(clamped / 3_600_000);
  const min = Math.trunc((clamped % 3_600_000) / 60_000);
  const s = Math.trunc((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(min)}:${p2(s)},${String(millis).padStart(3, "0")}`;
}

const MARKUP = /<[^>]*>/gu;

/**
 * Strip residual caption markup and normalize whitespace so duplicate lines compare equal. Removes
 * `<...>` tags (inline word timing / `<c>` styling that may survive a sloppy conversion) and decodes
 * the handful of HTML entities YouTube emits. Returns "" for blank/whitespace-only lines (the leading
 * `&nbsp;`/space rows YouTube pads cues with).
 */
function normalizeLine(line: string): string {
  return line
    .replaceAll(MARKUP, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/**
 * Parse SRT text into cues, tolerantly and driven by the `start --> end` timing lines rather than by
 * blank-line blocks — so it survives YouTube's quirks: whitespace-only padding rows inside a cue
 * (normalized away), space-padded separators, and CRLF/BOM. A pure-integer line immediately followed
 * by a timing line is treated as the next cue's index and dropped (a numeric caption not followed by a
 * timing line is kept). Returns `[]` for input with no valid cues, so callers can treat that as "not
 * SRT, leave alone".
 */
export function parseSrt(text: string): SrtCue[] {
  const lines = text
    .replace(/^\uFEFF/u, "")
    .replaceAll(/\r\n?/gu, "\n")
    .split("\n");
  const cues: SrtCue[] = [];
  let current: { startMs: number; endMs: number; lines: string[] } | null =
    null;
  const flush = (): void => {
    if (current !== null && current.lines.length > 0) cues.push(current);
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const timing = SRT_TIMING_LINE.exec(raw);
    if (timing !== null) {
      flush();
      const startMs = timeToMs(timing[1] ?? "");
      const endMs = timeToMs(timing[2] ?? "");
      current =
        startMs === null || endMs === null
          ? null
          : { startMs, endMs, lines: [] };
      continue;
    }
    if (current === null) continue;
    // Drop the next cue's index line (a pure integer immediately preceding a timing line).
    if (/^\d+$/u.test(raw.trim()) && SRT_TIMING_LINE.test(lines[i + 1] ?? "")) {
      continue;
    }
    const norm = normalizeLine(raw);
    if (norm.length > 0) current.lines.push(norm);
  }
  flush();
  return cues;
}

/** Serialize cues back to SRT text (1-based index, comma-decimal stamps, blank-line separated). */
export function serializeSrt(cues: readonly SrtCue[]): string {
  return cues
    .map((cue, i) => {
      const header = `${String(i + 1)}\n${msToSrtTime(cue.startMs)} --> ${msToSrtTime(cue.endMs)}`;
      return `${header}\n${cue.lines.join("\n")}\n`;
    })
    .join("\n");
}

/**
 * Heuristically detect the YouTube auto-caption rolling signature. Flags a track as rolling only when
 * the duplication is pervasive — a large share of cues either carry a line over from the previous cue
 * (the roll) or are ultra-short finalization duplicates — so normal subtitles (including legitimately
 * wrapped two-line cues, which don't repeat across consecutive cues) are never touched. Requires a
 * handful of cues so a tiny clip can't trip a threshold by chance.
 */
export function looksLikeRollingCaptions(cues: readonly SrtCue[]): boolean {
  if (cues.length < 4) return false;
  let carryOver = 0;
  let shortCues = 0;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (cue === undefined) continue;
    if (cue.endMs - cue.startMs <= SHORT_CUE_MS) shortCues++;
    if (i === 0) continue;
    const prev = cues[i - 1];
    if (prev === undefined) continue;
    const prevLines = new Set(prev.lines);
    if (cue.lines.some((l) => prevLines.has(l))) carryOver++;
  }
  const carryOverRatio = carryOver / (cues.length - 1);
  const shortRatio = shortCues / cues.length;
  return carryOverRatio >= 0.3 || shortRatio >= 0.25;
}

/**
 * Collapse rolling cues into clean single-line cues. Walks cues in time order; within each cue, walks
 * lines top→bottom and emits a line only when it isn't one of the last {@link VISIBLE_WINDOW} emitted
 * lines — so the carried-over (already-shown) line is dropped whether YouTube places new content on the
 * top or bottom row, while a phrase repeated much later still survives. Each emitted line starts at its
 * cue's start and ends when the next emitted line begins (the final line keeps its source end), giving
 * non-overlapping, one-line-at-a-time captions.
 */
export function collapseRollingCaptions(cues: readonly SrtCue[]): SrtCue[] {
  const emitted: { text: string; startMs: number; sourceEndMs: number }[] = [];
  for (const cue of cues) {
    for (const line of cue.lines) {
      const recent = emitted.slice(-VISIBLE_WINDOW).map((e) => e.text);
      if (recent.includes(line)) continue;
      emitted.push({
        text: line,
        startMs: cue.startMs,
        sourceEndMs: cue.endMs,
      });
    }
  }
  return emitted.map((e, i) => {
    const next = emitted[i + 1];
    // End when the next line appears; never produce a zero/negative span for same-start lines.
    const endMs =
      next === undefined
        ? e.sourceEndMs
        : Math.max(next.startMs, e.startMs + 1);
    return { startMs: e.startMs, endMs, lines: [e.text] };
  });
}

/**
 * Clean a YouTube-style rolling caption SRT into single-line cues. Returns the cleaned SRT text, or
 * `null` when the input isn't SRT or doesn't look like rolling captions — signalling the caller to
 * leave the original file untouched.
 */
export function cleanRollingSrt(srtText: string): string | null {
  const cues = parseSrt(srtText);
  if (cues.length === 0) return null;
  if (!looksLikeRollingCaptions(cues)) return null;
  const collapsed = collapseRollingCaptions(cues);
  if (collapsed.length === 0) return null;
  return serializeSrt(collapsed);
}
