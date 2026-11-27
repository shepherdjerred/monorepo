import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ChampionIdSchema } from "#src/model/core/identifiers.ts";
import { loadChampionGrounding } from "#src/tips/grounding.ts";
import { computeTipInputHash } from "#src/tips/input-hash.ts";
import {
  CURRENT_TIP_PATCH,
  type TipReader,
  createTipReader,
  getMatchupTips,
} from "#src/tips/load.ts";
import {
  AHRI,
  FIXTURE_PROMPT_VERSION,
  SYNDRA,
  ahriMidGeneralSet,
  ahriSyndraMidSets,
} from "#src/tips/tips.fixture.ts";

let directory: string;
let reader: TipReader;

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(`${directory}/${path.slice(0, path.lastIndexOf("/"))}`, {
    recursive: true,
  });
  await writeFile(`${directory}/${path}`, JSON.stringify(value));
}

beforeAll(async () => {
  directory = await mkdtemp(`${tmpdir()}/scout-tips-`);
  const [ahri, syndra] = await Promise.all([
    loadChampionGrounding(AHRI),
    loadChampionGrounding(SYNDRA),
  ]);
  const pairHash = computeTipInputHash(
    FIXTURE_PROMPT_VERSION,
    { kind: "matchup", lane: "middle", championIds: [AHRI, SYNDRA] },
    [ahri, syndra],
  );
  const { forward, reverse } = ahriSyndraMidSets(pairHash);
  await writeJson("matchup/middle/Ahri.json", {
    schemaVersion: 1,
    lane: "middle",
    champion: AHRI,
    sets: [forward],
  });
  // Written from facts that no longer hold.
  await writeJson("matchup/middle/Syndra.json", {
    schemaVersion: 1,
    lane: "middle",
    champion: SYNDRA,
    sets: [{ ...reverse, inputHash: "0".repeat(64) }],
  });
  const generalHash = computeTipInputHash(
    FIXTURE_PROMPT_VERSION,
    { kind: "general", lane: "middle", championIds: [AHRI] },
    [ahri],
  );
  await writeJson("general/middle.json", {
    schemaVersion: 1,
    lane: "middle",
    sets: [ahriMidGeneralSet(generalHash)],
  });
  await writeJson("general/top.json", {
    schemaVersion: 1,
    lane: "middle",
    sets: [],
  });
  reader = createTipReader(directory);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("tip loaders", () => {
  test("return fresh matchup tips with their ability icons and the patch", async () => {
    const tips = await reader.getMatchupTips({
      championId: AHRI,
      opponentId: SYNDRA,
      lane: "middle",
    });
    expect(tips?.patch).toBe(CURRENT_TIP_PATCH);
    expect(
      tips?.tips.map((tip) => tip.abilities.map((entry) => entry.name)),
    ).toEqual([
      ["Dark Sphere"],
      ["Scatter the Weak", "Charm"],
      ["Spirit Rush"],
    ]);
    expect(tips?.tips[1]).toEqual({
      text: "Her stun is her only defence. Bait it out, then Charm.",
      abilities: [
        { championId: SYNDRA, slot: "E", name: "Scatter the Weak" },
        { championId: AHRI, slot: "E", name: "Charm" },
      ],
    });
  });

  test("return general tips for a champion in a lane", async () => {
    const tips = await reader.getChampionLaneTips({
      championId: AHRI,
      lane: "middle",
    });
    expect(tips?.tips).toHaveLength(3);
    expect(tips?.tips[0]?.abilities).toEqual([
      { championId: AHRI, slot: "E", name: "Charm" },
    ]);
  });

  test("hide stale sets", async () => {
    expect(
      await reader.getMatchupTips({
        championId: SYNDRA,
        opponentId: AHRI,
        lane: "middle",
      }),
    ).toBeNull();
  });

  test("hide a set a filter thinned below the minimum", async () => {
    const [ahri, syndra] = await Promise.all([
      loadChampionGrounding(AHRI),
      loadChampionGrounding(SYNDRA),
    ]);
    const hash = computeTipInputHash(
      FIXTURE_PROMPT_VERSION,
      { kind: "matchup", lane: "middle", championIds: [AHRI, SYNDRA] },
      [ahri, syndra],
    );
    const { forward } = ahriSyndraMidSets(hash);
    const thinDirectory = await mkdtemp(`${tmpdir()}/scout-tips-thin-`);
    await mkdir(`${thinDirectory}/matchup/middle`, { recursive: true });
    await writeFile(
      `${thinDirectory}/matchup/middle/Ahri.json`,
      JSON.stringify({
        schemaVersion: 1,
        lane: "middle",
        champion: AHRI,
        sets: [{ ...forward, tips: forward.tips.slice(0, 2) }],
      }),
    );
    const thin = createTipReader(thinDirectory);
    expect(
      await thin.getMatchupTips({
        championId: AHRI,
        opponentId: SYNDRA,
        lane: "middle",
      }),
    ).toBeNull();
    await rm(thinDirectory, { recursive: true, force: true });
  });

  test("return null where the pruned matrix has nothing", async () => {
    const orianna = ChampionIdSchema.parse(61);
    expect(
      await reader.getMatchupTips({
        championId: AHRI,
        opponentId: orianna,
        lane: "middle",
      }),
    ).toBeNull();
    expect(
      await reader.getMatchupTips({
        championId: AHRI,
        opponentId: SYNDRA,
        lane: "top",
      }),
    ).toBeNull();
    expect(
      await reader.getChampionLaneTips({ championId: SYNDRA, lane: "middle" }),
    ).toBeNull();
    expect(
      await reader.getChampionLaneTips({ championId: AHRI, lane: "support" }),
    ).toBeNull();
  });

  test("throw on a file that breaks its schema", async () => {
    await expect(
      reader.getChampionLaneTips({ championId: AHRI, lane: "top" }),
    ).rejects.toThrow(/another lane/);
  });

  test("the committed reader answers without generated content", async () => {
    expect(
      await getMatchupTips({
        championId: AHRI,
        opponentId: SYNDRA,
        lane: "middle",
      }),
    ).toBeNull();
  });
});
