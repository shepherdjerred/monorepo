import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildSnapshotV2Fixture } from "./__fixtures__/snapshot-v2-fixture.ts";
import {
  assertSnapshotWithinBudget,
  parseSnapshotV2,
  serializeSnapshotV2,
} from "./snapshot-v2-files.ts";
import { readSnapshotDirectory } from "./snapshot-v2-fs.ts";
import {
  hasChampions,
  openSnapshot,
  openSnapshotOnce,
} from "./snapshot-v2-load.ts";

const FIXTURE_DIRECTORY = path.resolve(
  import.meta.dirname,
  "__fixtures__/snapshot-v2/champion-meta",
);
const FIXTURE_INDEX = path.join(FIXTURE_DIRECTORY, "index.json");
const COMMITTED_INDEX = path.resolve(
  import.meta.dirname,
  "../../data/generated/champion-meta/index.json",
);

describe("the fixture snapshot", () => {
  test("is what the builder writes, so a stale copy fails here", async () => {
    const built = serializeSnapshotV2(buildSnapshotV2Fixture());
    const committed = await readSnapshotDirectory(FIXTURE_DIRECTORY);
    expect(
      [...committed.keys()].toSorted(),
      "run scripts/write-champion-meta-fixture.ts",
    ).toEqual([...built.keys()].toSorted());
    for (const [file, text] of built) {
      expect(committed.get(file), file).toBe(text);
    }
  });

  test("is a consistent snapshot within the size budget", async () => {
    const committed = await readSnapshotDirectory(FIXTURE_DIRECTORY);
    expect(() => assertSnapshotWithinBudget(committed)).not.toThrow();
    const snapshot = parseSnapshotV2(committed);
    expect(snapshot.index.champions.length).toBeGreaterThan(15);
  });

  test("states its real context", async () => {
    const { index } = await openSnapshot(FIXTURE_INDEX);
    expect(index.context).toEqual({
      patch: "16.23",
      queueId: 420,
      queue: "ranked_solo",
      bracket: "high",
    });
    expect(index.source?.lane).not.toBeNull();
  });
});

describe("openSnapshot", () => {
  test("loads each champion file the index lists", async () => {
    const snapshot = await openSnapshot(FIXTURE_INDEX);
    const champions = await snapshot.champions();
    expect(champions.map((champion) => champion.slug)).toEqual(
      snapshot.index.champions.map((entry) => entry.slug),
    );
    const ahri = await snapshot.champion("ahri");
    expect(ahri.slices.map((slice) => slice.context.role)).toEqual([
      "MIDDLE",
      "UTILITY",
    ]);
  });

  test("answers a champion once", async () => {
    const snapshot = await openSnapshot(FIXTURE_INDEX);
    expect(await snapshot.champion("jinx")).toBe(
      await snapshot.champion("jinx"),
    );
  });

  test("refuses a champion the index does not list", async () => {
    const snapshot = await openSnapshot(FIXTURE_INDEX);
    await expect(snapshot.champion("not-a-champion")).rejects.toThrow(
      "does not list champion not-a-champion",
    );
  });

  test("refuses a relative path and a missing file", async () => {
    await expect(openSnapshot("index.json")).rejects.toThrow("absolute path");
    await expect(
      openSnapshot(path.join(FIXTURE_DIRECTORY, "missing.json")),
    ).rejects.toThrow("cannot be read");
  });

  test("opens an index file once per build", async () => {
    expect(openSnapshotOnce(FIXTURE_INDEX)).toBe(
      openSnapshotOnce(FIXTURE_INDEX),
    );
  });
});

describe("the committed snapshot", () => {
  test("holds only what the meta API served", async () => {
    const snapshot = await openSnapshot(COMMITTED_INDEX);
    if (!hasChampions(snapshot.index)) {
      expect(snapshot.index.source).toBeNull();
      return;
    }
    expect(snapshot.index.source?.buildId).not.toBe("fixture-build");
    const champions = await snapshot.champions();
    expect(champions).toHaveLength(snapshot.index.champions.length);
  });
});
