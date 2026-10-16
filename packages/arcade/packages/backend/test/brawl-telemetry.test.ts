import { describe, expect, it } from "vitest";
import {
  BrawlMemorySchema,
  BrawlTelemetry,
} from "#src/games/brawl/telemetry.ts";
import { brawlPlaying, brawlResults } from "./support/brawl-observations.ts";

// Scalar observations from a four-human RSBE01 rev 2 match on torvalds.
// The result screen showed Mario, Diddy, Link, Fox in that order.
const playing = BrawlMemorySchema.parse({
  scene: "scMelee",
  modeRule: 1_212_428,
  stage: 2_013_265_921,
  teams: 0,
  decision: 150_994_944,
  elapsedFrames: 4868,
  remainingFrames: null,
  selfDestructScore: -1,
  players: [
    {
      initial: 0,
      controller: 4_278_190_081,
      identity: 0,
      rank: 0,
      kos: 0,
      falls: 0,
      selfDestructs: 0,
    },
    {
      initial: 33_554_689,
      controller: 4_278_190_082,
      identity: 33_554_432,
      rank: 1,
      kos: 0,
      falls: 0,
      selfDestructs: 0,
    },
    {
      initial: 117_441_026,
      controller: 4_278_190_083,
      identity: 117_440_512,
      rank: 771,
      kos: 0,
      falls: 1,
      selfDestructs: 65_536,
    },
    {
      initial: 469_762_819,
      controller: 4_278_190_084,
      identity: 469_762_048,
      rank: 2,
      kos: 0,
      falls: 0,
      selfDestructs: 0,
    },
  ],
  owners: [0, 1, 2, 3].map((playerNo) => ({
    playerNo,
    stocks: 4_294_967_295,
    damage: null,
  })),
});
const results = BrawlMemorySchema.parse({
  ...playing,
  scene: "scVsResult",
  modeRule: 2_148_696_076,
  stage: 2_013_265_960,
  decision: 16_777_216,
  elapsedFrames: 7200,
  players: playing.players.map((player, index) => ({
    ...player,
    rank: [0, 514, 771, 257][index],
  })),
});

describe("Brawl guest telemetry", () => {
  it("keeps a real round through scene loading and reports the game's paused countdown", () => {
    const decoder = new BrawlTelemetry();
    const live = decoder.update(brawlPlaying);
    expect(live.remainingMs).toBe(14_433);
    expect(decoder.update(brawlPlaying).remainingMs).toBe(live.remainingMs);
    expect(live.fighters.map((fighter) => fighter.score)).toEqual([-6, 1]);
    expect(
      decoder.update({ ...brawlResults, scene: "scMemoryChange" }).phase,
    ).toBe("loading");
    expect(
      decoder.update({ ...brawlResults, scene: "", modeRule: 0 }).phase,
    ).toBe("loading");
    const final = decoder.update(brawlResults);
    expect(final.round).toBe(live.round);
    expect(final.phase).toBe("results");
    expect(final.stageId).toBe(8);
    expect(final.fighters.map((fighter) => fighter.placement)).toEqual([2, 1]);
    expect(final.fighters.map((fighter) => fighter.score)).toEqual([-7, 0]);
    decoder.update({ ...brawlResults, scene: "scSelctCharacter" });
    expect(decoder.update(brawlResults).phase).toBe("menu");
    expect(decoder.update(brawlPlaying).round).toBe(live.round + 1);
  });

  it("uses the round's configured self-destruct score after result globals change", () => {
    const decoder = new BrawlTelemetry();
    const live = decoder.update({ ...brawlPlaying, selfDestructScore: -2 });
    expect(live.fighters[0]?.score).toBe(-10);
    const final = decoder.update(brawlResults);
    expect(final.fighters[0]?.score).toBe(-12);
    expect(
      new BrawlTelemetry().update({ ...brawlPlaying, modeRule: 2_215_813_132 })
        .phase,
    ).toBe("menu");
    expect(
      new BrawlTelemetry().update({ ...brawlPlaying, remainingFrames: null })
        .remainingMs,
    ).toBeNull();
  });

  it("ignores plausible placeholder scores in menus and results without a played round", () => {
    const decoder = new BrawlTelemetry();
    const menu = decoder.update({ ...results, scene: "scRoot" });
    expect(menu.phase).toBe("menu");
    expect(menu.fighters).toEqual([]);
    expect(decoder.update(results).phase).toBe("menu");
  });

  it("waits through sudden death and preserves the stage and rules overwritten by the result scene", () => {
    const decoder = new BrawlTelemetry();
    const live = decoder.update(playing);
    expect(live.phase).toBe("playing");
    expect(live.stageId).toBe(1);
    expect(live.mode).toBe("time");
    expect(live.fighters.map((fighter) => fighter.characterId)).toEqual([
      0, 2, 7, 28,
    ]);
    expect(live.fighters.map((fighter) => fighter.human)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(live.fighters.map((fighter) => fighter.damage)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    const suddenDeath = decoder.update({
      ...playing,
      elapsedFrames: 7200,
      owners: [
        { playerNo: 0, stocks: 1, damage: null },
        { playerNo: 1, stocks: 1, damage: null },
        { playerNo: 3, stocks: 1, damage: null },
      ],
    });
    expect(suddenDeath.phase).toBe("sudden-death");
    expect(suddenDeath.fighters.map((fighter) => fighter.winner)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    const final = decoder.update(results);
    expect(final.phase).toBe("results");
    expect(final.round).toBe(live.round);
    expect(final.stageId).toBe(1);
    expect(final.mode).toBe("time");
    expect(final.fighters.map((fighter) => fighter.placement)).toEqual([
      1, 3, 4, 2,
    ]);
    expect(final.fighters.map((fighter) => fighter.winner)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(final.fighters.map((fighter) => fighter.selfDestructs)).toEqual([
      0, 0, 1, 0,
    ]);
  });

  it("rejects a paused quit and maps compact owner entries by player number", () => {
    const decoder = new BrawlTelemetry();
    const state = decoder.update({
      ...playing,
      owners: [{ playerNo: 3, stocks: 2, damage: 44.5 }],
    });
    expect(state.fighters.find((fighter) => fighter.seat === 3)?.damage).toBe(
      44.5,
    );
    expect(
      state.fighters.find((fighter) => fighter.seat === 0)?.damage,
    ).toBeNull();
    expect(decoder.update({ ...results, decision: 150_994_944 }).phase).toBe(
      "menu",
    );
    expect(decoder.update(results).phase).toBe("menu");
    const rematch = decoder.update(playing);
    expect(rematch.round).toBe(state.round + 1);
  });
});
