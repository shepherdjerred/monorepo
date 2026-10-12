import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { snapshotSaveDir } from "@shepherdjerred/discord-stream-lifecycle/persistence/save-history";

function clock(start: number): () => Date {
  let t = start;
  return () => {
    t += 1000;
    return new Date(t);
  };
}

describe("snapshotSaveDir", () => {
  let sessionDir: string;
  beforeEach(async () => {
    sessionDir = await mkdtemp(path.join(tmpdir(), "dsl-history-"));
  });
  afterEach(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it("returns null and writes nothing when no save exists yet", async () => {
    const snapshot = await snapshotSaveDir(sessionDir, {
      entries: ["game.sav", "memory"],
      keep: 3,
    });

    expect(snapshot).toBeNull();
    expect(await readdir(sessionDir)).toEqual([]);
  });

  it("copies files and directories that exist", async () => {
    await writeFile(path.join(sessionDir, "game.sav"), "save");
    await mkdir(path.join(sessionDir, "memory", "nested"), { recursive: true });
    await writeFile(path.join(sessionDir, "memory", "nested", "m.md"), "notes");
    await writeFile(path.join(sessionDir, "scratch.png"), "not a save");

    const snapshot = await snapshotSaveDir(sessionDir, {
      entries: ["game.sav", "memory", "missing.sav"],
      keep: 3,
      now: () => new Date("2026-10-11T18:39:31.123Z"),
    });

    expect(snapshot).toBe(
      path.join(sessionDir, "history", "20261011T183931123Z"),
    );
    expect(await readFile(path.join(snapshot ?? "", "game.sav"), "utf8")).toBe(
      "save",
    );
    expect(
      await readFile(
        path.join(snapshot ?? "", "memory", "nested", "m.md"),
        "utf8",
      ),
    ).toBe("notes");
    const copied = await readdir(snapshot ?? "");
    expect(copied.toSorted()).toEqual(["game.sav", "memory"]);
  });

  it("keeps only the newest snapshots", async () => {
    await writeFile(path.join(sessionDir, "game.sav"), "save");
    const now = clock(Date.UTC(2026, 9, 11));
    const taken: string[] = [];
    for (let i = 0; i < 5; i++) {
      await writeFile(path.join(sessionDir, "game.sav"), `save-${String(i)}`);
      const snapshot = await snapshotSaveDir(sessionDir, {
        entries: ["game.sav"],
        keep: 2,
        now,
      });
      taken.push(path.basename(snapshot ?? ""));
    }

    const history = await readdir(path.join(sessionDir, "history"));
    const kept = history.toSorted();
    expect(kept).toEqual(taken.slice(-2));
    expect(
      await readFile(
        path.join(sessionDir, "history", kept[1] ?? "", "game.sav"),
        "utf8",
      ),
    ).toBe("save-4");
  });

  it("rejects entries outside the session dir or inside history", async () => {
    for (const entry of [
      "../other-guild/game.sav",
      "/etc/passwd",
      "history",
      ".",
    ]) {
      await expect(
        snapshotSaveDir(sessionDir, { entries: [entry], keep: 1 }),
      ).rejects.toThrow(/inside the session dir/);
    }
  });

  it("rejects a non-positive keep", async () => {
    await expect(
      snapshotSaveDir(sessionDir, { entries: ["game.sav"], keep: 0 }),
    ).rejects.toThrow(/keep/);
  });
});
