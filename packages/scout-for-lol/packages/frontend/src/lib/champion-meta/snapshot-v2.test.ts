import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { BASE_MANIFEST } from "./__fixtures__/manifest-base.ts";
import fixture from "./__fixtures__/champion-meta.fixture.json";
import {
  buildChampionMetaSnapshot,
  buildChampionMetaSnapshots,
  type FetchLike,
} from "./refresh.ts";
import {
  SNAPSHOT_V2_BUDGET,
  SNAPSHOT_V2_DIRECTORY,
} from "@scout-for-lol/data/meta/snapshot-v2-budget.ts";
import {
  assertSnapshotWithinBudget,
  parseSnapshotV2,
  serializeSnapshotV2,
  snapshotBudgetViolations,
} from "./snapshot-v2-files.ts";
import {
  readSnapshotDirectory,
  writeSnapshotDirectory,
} from "./snapshot-v2-fs.ts";
import { EMPTY_SNAPSHOT_V2 } from "./snapshot-v2-schema.ts";

const ORIGIN = "https://meta.test";
const QUERY = "patch=16.3&queue=420&bracket=all";
const SCOUT_ROOT = path.resolve(import.meta.dirname, "../../../../..");

function rate(value: number) {
  return { value, lower: value - 0.05, upper: value + 0.05 };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

function apiError(status: number, code: string) {
  return json({ error: { code, message: code } }, { status });
}

const MANIFEST = {
  ...BASE_MANIFEST,
  lane: { firstDay: "2026-01-05", lastDay: "2026-01-07", days: 3 },
  champions: [
    { id: 103, name: "Ahri" },
    { id: 145, name: "Kai'Sa" },
    { id: 238, name: "Zed" },
  ],
  caveats: ["Counts come from the crawl."],
};

function fixtureChampion(id: number) {
  const found = fixture.champions.find((champion) => champion.id === id);
  if (found === undefined)
    throw new Error(`no fixture champion ${id.toString()}`);
  return found;
}

const ahri = fixtureChampion(103);
const kaisa = fixtureChampion(145);

/** Zed is a second mid laner: Ahri and Zed list each other. */
const zed = { ...ahri, id: 238, name: "Zed", slug: "zed" };

function championBody(champion: typeof ahri) {
  return {
    schemaVersion: 1,
    buildId: "build-1",
    championId: champion.id,
    championName: champion.name,
    slices: champion.slices,
  };
}

const MID_CONTEXT = {
  patch: "16.3",
  queueId: 420,
  queue: "ranked_solo",
  bracket: "all",
  role: "MIDDLE",
};

function lane(games: number, ahead: number, of: number) {
  return {
    games,
    ahead,
    aheadRate: rate(ahead / games),
    share: rate(games / of),
    denominator: "matchup_games",
  };
}

function matchupsBody(
  championId: number,
  championName: string,
  opponents: object[],
  buildId = "build-1",
) {
  return {
    schemaVersion: 1,
    buildId,
    championId,
    championName,
    context: {
      patch: "16.3",
      queueId: 420,
      queue: "ranked_solo",
      bracket: "all",
    },
    slices: [{ context: MID_CONTEXT, opponents }],
  };
}

const AHRI_VS_ZED = {
  championId: 238,
  championName: "Zed",
  games: 80,
  wins: 50,
  winRate: rate(0.625),
  spells: [
    {
      spellIds: [4, 14],
      games: 50,
      wins: 34,
      winRate: rate(0.68),
      share: rate(0.625),
      denominator: "matchup_games",
    },
  ],
  lane: lane(36, 24, 80),
};
const AHRI_VS_ANNIE = {
  championId: 1,
  championName: "Annie",
  games: 40,
  wins: 18,
  winRate: rate(0.45),
};
const ZED_VS_AHRI = {
  championId: 103,
  championName: "Ahri",
  games: 80,
  wins: 30,
  winRate: rate(0.375),
  lane: lane(36, 12, 80),
};

type Routes = Record<string, () => Response>;

function api(overrides: Routes = {}, requested: string[] = []): FetchLike {
  const routes: Routes = {
    "/api/meta/v1/manifest": () => json(MANIFEST),
    [`/api/meta/v1/champions/103?${QUERY}`]: () => json(championBody(ahri)),
    [`/api/meta/v1/champions/145?${QUERY}`]: () => json(championBody(kaisa)),
    [`/api/meta/v1/champions/238?${QUERY}`]: () => json(championBody(zed)),
    [`/api/meta/v1/matchups/103?${QUERY}`]: () =>
      json(matchupsBody(103, "Ahri", [AHRI_VS_ZED, AHRI_VS_ANNIE])),
    [`/api/meta/v1/matchups/145?${QUERY}`]: () =>
      apiError(404, "matchup_not_found"),
    [`/api/meta/v1/matchups/238?${QUERY}`]: () =>
      json(matchupsBody(238, "Zed", [ZED_VS_AHRI])),
    ...overrides,
  };
  return async (url) => {
    requested.push(url);
    const route = routes[url.slice(ORIGIN.length)];
    if (route === undefined) throw new Error(`unexpected request ${url}`);
    return route();
  };
}

const noSleep = (): Promise<void> => Promise.resolve();

async function built(overrides: Routes = {}, requested: string[] = []) {
  return await buildChampionMetaSnapshots({
    origin: ORIGIN,
    fetch: api(overrides, requested),
    sleep: noSleep,
  });
}

async function splitSnapshot(overrides: Routes = {}) {
  const { split } = await built(overrides);
  return split;
}

function sortedByPath(files: ReadonlyMap<string, string>) {
  return new Map(
    [...files].toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "champion-meta-v2-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("snapshot v2 from the meta API", () => {
  test("splits one answer into an index, champion files and matchup files", async () => {
    const requested: string[] = [];
    const { split } = await built({}, requested);

    expect([...split.champions.keys()]).toEqual([
      "champions/ahri.json",
      "champions/kaisa.json",
      "champions/zed.json",
    ]);
    expect([...split.matchups.keys()].toSorted()).toEqual([
      "matchups/ahri/middle/annie.json",
      "matchups/ahri/middle/zed.json",
      "matchups/zed/middle/ahri.json",
    ]);
    expect(split.index.context).toEqual({
      patch: "16.3",
      queueId: 420,
      queue: "ranked_solo",
      bracket: "all",
    });
    expect(split.index.source).toMatchObject({
      buildId: "build-1",
      minMatchupGames: 30,
      lane: { firstDay: "2026-01-05", lastDay: "2026-01-07", days: 3 },
    });
    expect(
      split.index.champions.map((champion) => [
        champion.slug,
        champion.roles.map((role) => [role.role, role.opponents]),
      ]),
    ).toEqual([
      ["ahri", [["MIDDLE", 2]]],
      [
        "kaisa",
        [
          ["BOTTOM", 0],
          ["MIDDLE", 0],
        ],
      ],
      ["zed", [["MIDDLE", 1]]],
    ]);
    // One champion and one matchups request per champion with a slice.
    expect(requested).toHaveLength(7);
  });

  test("a matchup file holds both sides, their slices and the lane figure with its count", async () => {
    const { split } = await built();
    const matchup = split.matchups.get("matchups/ahri/middle/zed.json");
    expect(matchup).toMatchObject({
      buildId: "build-1",
      context: { patch: "16.3", role: "MIDDLE" },
      champion: {
        id: 103,
        slug: "ahri",
        slice: { games: ahri.slices[0]?.sample.games, tier: "A" },
        record: { games: 80, wins: 50, lane: { games: 36, ahead: 24 } },
      },
      opponent: {
        id: 238,
        slug: "zed",
        slice: { tier: "A" },
        // Zed's own side of the same matchup, from its matchups file.
        record: { games: 80, wins: 30, lane: { games: 36, ahead: 12 } },
      },
    });
    expect(matchup?.champion.record.spells?.[0]?.spellIds).toEqual([4, 14]);

    // Annie met the floor against Ahri but has no slice or listing of her own.
    const annie = split.matchups.get("matchups/ahri/middle/annie.json");
    expect(annie?.opponent).toMatchObject({
      id: 1,
      slug: "annie",
      slice: null,
      record: null,
    });
    expect(annie?.champion.record.lane).toBeUndefined();
  });

  test("a champion file lists every opponent per role with its record", async () => {
    const { split } = await built();
    const champion = split.champions.get("champions/ahri.json");
    expect(champion?.slices.map((slice) => slice.context.role)).toEqual([
      "MIDDLE",
    ]);
    expect(
      champion?.matchups[0]?.opponents.map((opponent) => [
        opponent.slug,
        opponent.games,
        opponent.lane?.games,
      ]),
    ).toEqual([
      ["zed", 80, 36],
      ["annie", 40, undefined],
    ]);
    expect(split.champions.get("champions/kaisa.json")?.matchups).toEqual([]);
  });

  test("keeps the single-file snapshot the same as the v1 refresh builds", async () => {
    const { single } = await built();
    const alone = await buildChampionMetaSnapshot({
      origin: ORIGIN,
      fetch: api(),
      sleep: noSleep,
    });
    expect(single).toEqual(alone);
    expect(single.champions.map((champion) => champion.slug)).toEqual([
      "ahri",
      "kaisa",
      "zed",
    ]);
  });

  test("the v1 refresh does not fetch matchups", async () => {
    const requested: string[] = [];
    await buildChampionMetaSnapshot({
      origin: ORIGIN,
      fetch: api({}, requested),
      sleep: noSleep,
    });
    expect(requested.some((url) => url.includes("/matchups/"))).toBe(false);
  });

  test("is the empty snapshot while the API has published nothing", async () => {
    const { split } = await built({
      "/api/meta/v1/manifest": () => apiError(503, "meta_unavailable"),
    });
    expect(split).toEqual(EMPTY_SNAPSHOT_V2);
    expect([...serializeSnapshotV2(split).keys()]).toEqual(["index.json"]);
  });

  test("rejects matchups served from a different build than the manifest", async () => {
    await expect(
      built({
        [`/api/meta/v1/matchups/103?${QUERY}`]: () =>
          json(matchupsBody(103, "Ahri", [AHRI_VS_ZED], "build-2")),
      }),
    ).rejects.toThrow(/build changed/u);
  });

  test("rejects matchups made at another patch than the snapshot's", async () => {
    const body = matchupsBody(103, "Ahri", [AHRI_VS_ZED]);
    await expect(
      built({
        [`/api/meta/v1/matchups/103?${QUERY}`]: () =>
          json({
            ...body,
            slices: [
              { ...body.slices[0], context: { ...MID_CONTEXT, patch: "16.2" } },
            ],
          }),
      }),
    ).rejects.toThrow(/not the snapshot's/u);
  });

  test("fails loudly on an unexpected matchups answer", async () => {
    await expect(
      built({
        [`/api/meta/v1/matchups/103?${QUERY}`]: () => apiError(500, "internal"),
      }),
    ).rejects.toThrow(/500/u);
  });
});

describe("snapshot v2 files", () => {
  test("round-trips through the serialized files and the directory", async () => {
    const { split } = await built();
    const files = serializeSnapshotV2(split);
    expect(parseSnapshotV2(files)).toEqual(split);

    const target = path.join(directory, "champion-meta");
    await writeSnapshotDirectory(target, files);
    const read = await readSnapshotDirectory(target);
    expect(sortedByPath(read)).toEqual(sortedByPath(files));
    expect(parseSnapshotV2(read)).toEqual(split);

    // A second refresh over the same answers rewrites identical bytes.
    const again = serializeSnapshotV2(await splitSnapshot());
    expect([...again]).toEqual([...files]);
  });

  test("replaces the directory wholesale, so a dropped matchup does not linger", async () => {
    const target = path.join(directory, "champion-meta");
    const { split } = await built();
    await writeSnapshotDirectory(target, serializeSnapshotV2(split));
    const without = await built({
      [`/api/meta/v1/matchups/103?${QUERY}`]: () =>
        json(matchupsBody(103, "Ahri", [AHRI_VS_ZED])),
    });
    await writeSnapshotDirectory(target, serializeSnapshotV2(without.split));
    const read = await readSnapshotDirectory(target);
    expect(read.has("matchups/ahri/middle/annie.json")).toBe(false);
    expect(parseSnapshotV2(read)).toEqual(without.split);
  });

  test("only replaces a directory named champion-meta", async () => {
    await expect(
      writeSnapshotDirectory(path.join(directory, "other"), new Map()),
    ).rejects.toThrow(/Refusing/u);
    await expect(
      writeSnapshotDirectory("champion-meta", new Map()),
    ).rejects.toThrow(/Refusing/u);
  });

  test("a file the index does not reach, or one that is missing, is an error", async () => {
    const files = serializeSnapshotV2(await splitSnapshot());
    const stray = new Map(files);
    stray.set("matchups/ahri/middle/ghost.json", "{}\n");
    expect(() => parseSnapshotV2(stray)).toThrow(/does not reach/u);

    const missing = new Map(files);
    missing.delete("matchups/ahri/middle/zed.json");
    expect(() => parseSnapshotV2(missing)).toThrow(/missing/u);
  });

  test("a matchup file from another build is an error", async () => {
    const files = new Map(serializeSnapshotV2(await splitSnapshot()));
    const original = files.get("matchups/ahri/middle/zed.json") ?? "";
    files.set(
      "matchups/ahri/middle/zed.json",
      original.replace('"build-1"', '"build-0"'),
    );
    expect(() => parseSnapshotV2(files)).toThrow(/not the matchup/u);
  });
});

describe("snapshot v2 size budget", () => {
  test("the fixture snapshot is within every budget, with a matchup file far under one", async () => {
    const files = serializeSnapshotV2(await splitSnapshot());
    expect(snapshotBudgetViolations(files)).toEqual([]);
    expect(() => assertSnapshotWithinBudget(files)).not.toThrow();
    const matchup = files.get("matchups/ahri/middle/zed.json") ?? "";
    expect(matchup.length).toBeLessThan(
      SNAPSHOT_V2_BUDGET.matchup.maxBytes / 2,
    );
  });

  test("names a file over its budget and a class over its total", () => {
    const big = "x".repeat(SNAPSHOT_V2_BUDGET.matchup.maxBytes + 1);
    const violations = snapshotBudgetViolations(
      new Map([["matchups/a/top/b.json", big]]),
    );
    expect(violations).toEqual([
      `matchups/a/top/b.json: ${big.length.toString()} bytes exceeds ${SNAPSHOT_V2_BUDGET.matchup.maxBytes.toString()}`,
    ]);
    expect(() =>
      assertSnapshotWithinBudget(new Map([["matchups/a/top/b.json", big]])),
    ).toThrow(/over its size budget/u);
  });

  test("the committed snapshot directory parses, whatever the crawl has published", async () => {
    const committed = await readSnapshotDirectory(
      path.join(SCOUT_ROOT, "packages/frontend", SNAPSHOT_V2_DIRECTORY),
    );
    expect(() => parseSnapshotV2(committed)).not.toThrow();
    expect(snapshotBudgetViolations(committed)).toEqual([]);
  });
});
