import { describe, expect, test } from "bun:test";
import {
  findChapterAt,
  parseFfprobeChapters,
  toChapters,
  type Chapter,
} from "@shepherdjerred/streambot/sources/chapters.ts";

describe("parseFfprobeChapters", () => {
  test("maps ffprobe JSON (string seconds + tag titles) to 1-based chapters", () => {
    const stdout = JSON.stringify({
      chapters: [
        {
          start_time: "0.000000",
          end_time: "120.500000",
          tags: { title: "Intro" },
        },
        { start_time: "120.500000", end_time: "300.000000" },
      ],
    });
    expect(parseFfprobeChapters(stdout)).toEqual([
      { index: 1, title: "Intro", startSeconds: 0, endSeconds: 120 },
      { index: 2, title: "Chapter 2", startSeconds: 120, endSeconds: 300 },
    ]);
  });

  test("returns [] when there are no chapters", () => {
    expect(parseFfprobeChapters(JSON.stringify({ chapters: [] }))).toEqual([]);
    expect(parseFfprobeChapters(JSON.stringify({}))).toEqual([]);
  });

  test("throws on malformed JSON (callers swallow)", () => {
    expect(() => parseFfprobeChapters("not json")).toThrow();
  });
});

describe("toChapters", () => {
  test("falls back to a generated title and floors/clamps seconds", () => {
    expect(
      toChapters([
        { startSeconds: 10.9, endSeconds: 20.1, title: "" },
        { startSeconds: -5, endSeconds: null, title: "Named" },
      ]),
    ).toEqual([
      { index: 1, title: "Chapter 1", startSeconds: 10, endSeconds: 20 },
      { index: 2, title: "Named", startSeconds: 0, endSeconds: null },
    ]);
  });
});

describe("findChapterAt", () => {
  const chapters: Chapter[] = [
    { index: 1, title: "Intro", startSeconds: 0, endSeconds: 90 },
    { index: 2, title: "Body", startSeconds: 90, endSeconds: 300 },
    { index: 3, title: "Outro", startSeconds: 300, endSeconds: null },
  ];

  test("returns null for an empty list", () => {
    expect(findChapterAt([], 42)).toBeNull();
  });

  test("returns null for a time before the first chapter", () => {
    const offset: Chapter[] = [
      { index: 1, title: "Intro", startSeconds: 30, endSeconds: 60 },
    ];
    expect(findChapterAt(offset, 5)).toBeNull();
  });

  test("picks the chapter whose [start, next) window contains the time", () => {
    expect(findChapterAt(chapters, 0)?.index).toBe(1);
    expect(findChapterAt(chapters, 89.9)?.index).toBe(1);
    expect(findChapterAt(chapters, 90)?.index).toBe(2);
    expect(findChapterAt(chapters, 250)?.index).toBe(2);
  });

  test("the last chapter extends to infinity even with null endSeconds", () => {
    expect(findChapterAt(chapters, 300)?.index).toBe(3);
    expect(findChapterAt(chapters, 9999)?.index).toBe(3);
  });
});
