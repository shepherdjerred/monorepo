import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchFullMatch } from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import { fetchPlayerMatchHistory } from "#src/reports/duckdb/lake-reads.ts";
import {
  fetchGuildAccountCounts,
  fetchGuildMatchRows,
} from "#src/reports/duckdb/community/community-lake.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";

const lakeDir = await mkdtemp(path.join(tmpdir(), "scout-community-lake-"));
const guildId = testGuildId("616161");
const created = new Date("2026-09-20T12:00:00Z");
const puuids = Array.from({ length: 10 }, (_, index) =>
  testPuuid(`community-${index.toString()}`),
);

function fact(index: number, matchId = "NA1_standard") {
  return {
    playerId: index + 1,
    playerAlias: `Player ${index.toString()}`,
    matchId,
    puuid: puuids[index] ?? testPuuid("missing"),
    queue: "solo",
    win: index < 5,
    surrendered: false,
    kills: 3,
    deaths: 2,
    assists: 4,
    teamId: index < 5 ? 100 : 200,
    championName: "Ashe",
    teamPosition:
      ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][index % 5] ?? "TOP",
    gameCreationAt: created,
  };
}

beforeAll(async () => {
  await resetTestLake(lakeDir);
  await writeTestLake(lakeDir, {
    serverId: guildId,
    matchFacts: [
      ...Array.from({ length: 10 }, (_, index) => fact(index)),
      {
        ...fact(0, "NA1_arena"),
        queue: "arena",
        queueId: 1700,
        gameMode: "CHERRY",
        mapId: 30,
        playerSubteamId: 1,
        placement: 2,
        subteamPlacement: 2,
        augmentIds: [4001, 4002, null, null, null, null],
      },
    ],
  });
});

afterAll(async () => {
  await rm(lakeDir, { recursive: true, force: true });
});

describe("community lake reads", () => {
  test("returns full rosters only for matches reached through authorized PUUIDs", async () => {
    const rows = await fetchGuildMatchRows({
      puuids: [puuids[0] ?? ""],
      queues: ["solo"],
      lakeDir,
    });
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((row) => row.match_id))).toEqual(
      new Set(["NA1_standard"]),
    );
    expect(
      await fetchGuildMatchRows({ puuids: [testPuuid("outsider")], lakeDir }),
    ).toEqual([]);
  });

  test("reads Arena placement and augments through detail and history", async () => {
    const guildRows = await fetchGuildMatchRows({
      puuids: [puuids[0] ?? ""],
      queues: ["arena"],
      lakeDir,
    });
    expect(guildRows[0]?.player_subteam_id).toBe(1);
    const detail = await fetchFullMatch({ matchId: "NA1_arena", lakeDir });
    expect(detail[0]).toMatchObject({
      player_subteam_id: 1,
      placement: 2,
      subteam_placement: 2,
      augment_1_id: 4001,
      augment_2_id: 4002,
    });
    const history = await fetchPlayerMatchHistory({
      puuids: [puuids[0] ?? ""],
      queues: ["arena"],
      lakeDir,
    });
    expect(history[0]).toMatchObject({ placement: 2, augment_1_id: 4001 });
    const counts = await fetchGuildAccountCounts({
      puuids: [puuids[0] ?? ""],
      lakeDir,
    });
    expect(counts[0]?.games).toBe(2);
  });
});
