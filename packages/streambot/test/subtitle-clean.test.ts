import { describe, expect, test } from "bun:test";
import {
  cleanRollingSrt,
  collapseRollingCaptions,
  looksLikeRollingCaptions,
  parseSrt,
  serializeSrt,
  type SrtCue,
} from "@shepherdjerred/streambot/sources/subtitle-clean.ts";

/**
 * A realistic YouTube auto-caption SRT for the transcript `hey` / `hello` / `hi`: each phrase is built
 * up, gets a ~10 ms finalization cue, then lingers as the top line while the next phrase appears on the
 * bottom — the doubled/stale scroll the cleaner exists to collapse.
 */
const ROLLING_SRT = `1
00:00:00,000 --> 00:00:01,000
hey

2
00:00:01,000 --> 00:00:01,010
hey

3
00:00:01,010 --> 00:00:02,000
hey
hello

4
00:00:02,000 --> 00:00:02,010
hello

5
00:00:02,010 --> 00:00:03,000
hello
hi

6
00:00:03,000 --> 00:00:03,500
hi
`;

/** What the rolling input must collapse to: one clean single-line cue per phrase, in order. */
const CLEANED_SRT = `1
00:00:00,000 --> 00:00:01,010
hey

2
00:00:01,010 --> 00:00:02,010
hello

3
00:00:02,010 --> 00:00:03,000
hi
`;

/** A normal, human-authored SRT — including a legitimately wrapped two-line cue that must survive. */
const CLEAN_SRT = `1
00:00:00,000 --> 00:00:02,000
Hello there.

2
00:00:02,000 --> 00:00:04,000
General Kenobi.

3
00:00:04,000 --> 00:00:06,000
You are a bold one.

4
00:00:06,000 --> 00:00:09,000
Back away. I will deal
with this Jedi slime myself.
`;

describe("parseSrt / serializeSrt", () => {
  test("round-trips a clean SRT (index, comma stamps, multi-line cue)", () => {
    const cues = parseSrt(CLEAN_SRT);
    expect(cues).toHaveLength(4);
    expect(cues[0]).toEqual({
      startMs: 0,
      endMs: 2000,
      lines: ["Hello there."],
    });
    expect(cues[3]?.lines).toEqual([
      "Back away. I will deal",
      "with this Jedi slime myself.",
    ]);
    expect(serializeSrt(cues)).toBe(CLEAN_SRT);
  });

  test("tolerates CRLF, a BOM, and blank padding lines; returns [] for non-SRT", () => {
    const crlf = "﻿1\r\n00:00:01,500 --> 00:00:02,500\r\n \r\nhi there\r\n";
    expect(parseSrt(crlf)).toEqual([
      { startMs: 1500, endMs: 2500, lines: ["hi there"] },
    ]);
    expect(parseSrt("not a subtitle file at all")).toEqual([]);
  });
});

describe("looksLikeRollingCaptions", () => {
  test("flags the rolling auto-caption signature", () => {
    expect(looksLikeRollingCaptions(parseSrt(ROLLING_SRT))).toBe(true);
  });

  test("leaves a normal clean SRT alone (no false positive on wrapped cues)", () => {
    expect(looksLikeRollingCaptions(parseSrt(CLEAN_SRT))).toBe(false);
  });

  test("needs a handful of cues before deciding", () => {
    const tiny: SrtCue[] = [
      { startMs: 0, endMs: 1000, lines: ["a"] },
      { startMs: 1000, endMs: 1010, lines: ["a"] },
    ];
    expect(looksLikeRollingCaptions(tiny)).toBe(false);
  });
});

describe("collapseRollingCaptions", () => {
  test("collapses the rolling scroll to one line per phrase, in order", () => {
    const out = collapseRollingCaptions(parseSrt(ROLLING_SRT));
    expect(out.map((c) => c.lines)).toEqual([["hey"], ["hello"], ["hi"]]);
  });

  test("is robust to new content on the TOP row (reversed rolling)", () => {
    // Some cues place the new phrase above the carried one; order must still come out chronological.
    const reversed: SrtCue[] = [
      { startMs: 0, endMs: 1000, lines: ["hey"] },
      { startMs: 1000, endMs: 2000, lines: ["hello", "hey"] },
      { startMs: 2000, endMs: 3000, lines: ["hi", "hello"] },
    ];
    expect(collapseRollingCaptions(reversed).map((c) => c.lines)).toEqual([
      ["hey"],
      ["hello"],
      ["hi"],
    ]);
  });

  test("preserves a phrase legitimately repeated far apart", () => {
    const cues: SrtCue[] = [
      { startMs: 0, endMs: 1000, lines: ["yeah"] },
      { startMs: 1000, endMs: 2000, lines: ["okay"] },
      { startMs: 2000, endMs: 3000, lines: ["sure"] },
      { startMs: 3000, endMs: 4000, lines: ["yeah"] },
    ];
    expect(collapseRollingCaptions(cues).map((c) => c.lines[0])).toEqual([
      "yeah",
      "okay",
      "sure",
      "yeah",
    ]);
  });
});

describe("cleanRollingSrt", () => {
  test("rewrites a rolling auto-caption SRT to clean single-line cues", () => {
    expect(cleanRollingSrt(ROLLING_SRT)).toBe(CLEANED_SRT);
  });

  test("returns null for an already-clean SRT (caller leaves the file untouched)", () => {
    expect(cleanRollingSrt(CLEAN_SRT)).toBeNull();
  });

  test("returns null for non-SRT input", () => {
    expect(cleanRollingSrt("WEBVTT\n\nnope")).toBeNull();
  });

  test("collapses real `ffmpeg -i in.vtt out.srt` output of a rolling auto-caption", () => {
    // Captured from converting a YouTube-ASR-format VTT (word `<c>` tags + finalization cues) with
    // real ffmpeg — the exact path yt-dlp uses. Note ffmpeg leaks a stray VTT timing line into the
    // first cue's text (a real quirk); the timing-line-driven parser still recovers clean cues.
    const ffmpegSrt = `1
00:00:00,000 --> 00:00:02,000
all right so here

00:00:02.000 --> 00:00:02.010 align:start position:0%
all right so here

2
00:00:02,000 --> 00:00:04,000
all right so here
we are in front

3
00:00:04,000 --> 00:00:04,010
we are in front

4
00:00:04,000 --> 00:00:06,000
we are in front
of the elephants

5
00:00:06,000 --> 00:00:06,010
of the elephants
`;
    expect(cleanRollingSrt(ffmpegSrt)).toBe(`1
00:00:00,000 --> 00:00:02,000
all right so here

2
00:00:02,000 --> 00:00:04,000
we are in front

3
00:00:04,000 --> 00:00:06,000
of the elephants
`);
  });

  test("strips residual inline markup before de-duplicating", () => {
    // If a `<c>`/word-timing tag ever survives conversion, the line must still match its plain twin.
    const withTags = `1
00:00:00,000 --> 00:00:01,000
hey

2
00:00:01,000 --> 00:00:01,010
hey

3
00:00:01,010 --> 00:00:02,000
hey
hel<00:00:01,500>lo

4
00:00:02,000 --> 00:00:02,010
hello

5
00:00:02,010 --> 00:00:03,000
hello
hi

6
00:00:03,000 --> 00:00:03,500
hi
`;
    expect(cleanRollingSrt(withTags)).toBe(CLEANED_SRT);
  });
});
