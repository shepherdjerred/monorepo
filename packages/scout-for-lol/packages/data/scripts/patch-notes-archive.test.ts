import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  archivePatchNotes,
  archiveThenAnalyze,
  listArchivedPatches,
} from "./patch-notes-archive.ts";
import type { RiotPatch } from "./riot-patch.ts";

const PATCH: RiotPatch = {
  patch: "26.20",
  major: 26,
  minor: 20,
  title: "Patch 26.20 Notes",
  tagline: "",
  url: "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-20-notes",
};

describe("archiveThenAnalyze", () => {
  test("archives before analyzing", async () => {
    const calls: string[] = [];
    const result = await archiveThenAnalyze(
      PATCH,
      "<html>",
      (_patch, html) => {
        calls.push(`analyze:${html}`);
        return Promise.resolve("changeset");
      },
      (_patch, html) => {
        calls.push(`archive:${html}`);
        return Promise.resolve();
      },
    );
    expect(result).toBe("changeset");
    expect(calls).toEqual(["archive:<html>", "analyze:<html>"]);
  });

  test("keeps the archived page when analysis throws", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "patch-archive-"));
    try {
      await expect(
        archiveThenAnalyze(
          PATCH,
          "<html>raw</html>",
          () => Promise.reject(new Error("model unavailable")),
          (patch, html) => archivePatchNotes(patch, html, dir),
        ),
      ).rejects.toThrow("model unavailable");
      expect(await readFile(path.join(dir, "26.20.html"), "utf8")).toBe(
        "<html>raw</html>",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("does not analyze when archiving fails", async () => {
    let analyzed = false;
    await expect(
      archiveThenAnalyze(
        PATCH,
        "<html>",
        () => {
          analyzed = true;
          return Promise.resolve(undefined);
        },
        () => Promise.reject(new Error("disk full")),
      ),
    ).rejects.toThrow("disk full");
    expect(analyzed).toBe(false);
  });
});

describe("listArchivedPatches", () => {
  test("lists only patch html files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "patch-archive-"));
    try {
      await writeFile(path.join(dir, "26.14.html"), "a");
      await writeFile(path.join(dir, "26.16.html"), "b");
      await writeFile(path.join(dir, ".gitkeep"), "");
      await writeFile(path.join(dir, "notes.txt"), "c");
      expect([...(await listArchivedPatches(dir))].sort()).toEqual([
        "26.14",
        "26.16",
      ]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
