import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findBestMatch,
  scanLibrary,
  searchLibrary,
  type LibraryEntry,
} from "@shepherdjerred/streambot/sources/library.ts";

const ROOT = path.join(tmpdir(), "streambot-library-test");
const MOVIES = path.join(ROOT, "movies");
const TV = path.join(ROOT, "tv");

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  // Bun.write creates intermediate directories, so a nested library tree falls out for free.
  await Bun.write(
    path.join(MOVIES, "Avengers Endgame (2019)", "Avengers Endgame (2019).mkv"),
    "x",
  );
  await Bun.write(
    path.join(MOVIES, "Black Swan (2010)", "Black Swan.mp4"),
    "x",
  );
  await Bun.write(path.join(MOVIES, "Black Swan (2010)", "poster.jpg"), "x");
  await Bun.write(
    path.join(TV, "The Show", "Season 01", "The Show - S01E01.mkv"),
    "x",
  );
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe("scanLibrary", () => {
  test("recursively finds video files and excludes other extensions", async () => {
    const entries = await scanLibrary(
      [
        { dir: MOVIES, label: "movies" },
        { dir: TV, label: "tv" },
      ],
      ["mkv", "mp4"],
    );

    const titles = entries.map((entry) => entry.title).toSorted();
    expect(titles).toEqual([
      "Avengers Endgame (2019)",
      "Black Swan",
      "The Show - S01E01",
    ]);

    const tvEntry = entries.find(
      (entry) => entry.title === "The Show - S01E01",
    );
    expect(tvEntry?.library).toBe("tv");
    expect(tvEntry?.relativePath).toBe(
      "The Show/Season 01/The Show - S01E01.mkv",
    );
    expect(tvEntry?.path).toBe(
      path.join(TV, "The Show", "Season 01", "The Show - S01E01.mkv"),
    );
  });

  test("tolerates a missing root", async () => {
    const entries = await scanLibrary(
      [{ dir: path.join(ROOT, "does-not-exist"), label: "x" }],
      ["mkv"],
    );
    expect(entries).toEqual([]);
  });
});

describe("searchLibrary", () => {
  const entries: LibraryEntry[] = [
    {
      title: "Black Swan",
      path: "/m/a.mkv",
      relativePath: "a.mkv",
      library: "movies",
    },
    {
      title: "Black Hawk Down",
      path: "/m/b.mkv",
      relativePath: "b.mkv",
      library: "movies",
    },
    {
      title: "Avengers Endgame",
      path: "/m/c.mkv",
      relativePath: "c.mkv",
      library: "movies",
    },
  ];

  test("ranks exact, then prefix, then substring matches", () => {
    const results = searchLibrary(entries, "black");
    expect(results.map((entry) => entry.title)).toEqual([
      "Black Hawk Down",
      "Black Swan",
    ]);
  });

  test("matches a substring anywhere in the title", () => {
    expect(
      searchLibrary(entries, "endgame").map((entry) => entry.title),
    ).toEqual(["Avengers Endgame"]);
  });

  test("returns nothing for an empty or unmatched query", () => {
    expect(searchLibrary(entries, "   ")).toEqual([]);
    expect(searchLibrary(entries, "nonexistent")).toEqual([]);
  });

  test("findBestMatch returns the single top hit or null", () => {
    expect(findBestMatch(entries, "Black Swan")?.title).toBe("Black Swan");
    expect(findBestMatch(entries, "nope")).toBeNull();
  });
});
