import { BrawlMemorySchema } from "#src/games/brawl/telemetry.ts";

// RSBE01 rev 2, an unmodified two-minute Mario versus CPU Pit match on
// torvalds. The visible result awarded Pit first and Mario second. Falls in
// guest memory include self-destructs: Mario's result screen showed 2 + 5.
// The signed penalty was read separately from gmMeleeInitData (default -1).
export const brawlPlaying = BrawlMemorySchema.parse({
  scene: "scMelee",
  modeRule: 688_140,
  stage: 2_013_265_928,
  teams: 0,
  decision: 150_994_944,
  elapsedFrames: 6334,
  remainingFrames: 866,
  selfDestructScore: -1,
  players: [
    {
      initial: 0,
      controller: 4_278_190_081,
      identity: 0,
      rank: 2_752_769,
      kos: 0,
      falls: 6,
      selfDestructs: 262_144,
    },
    {
      initial: 419_496_193,
      controller: 4_278_452_482,
      identity: 419_496_961,
      rank: 65_536,
      kos: 2,
      falls: 1,
      selfDestructs: 65_538,
    },
    {
      initial: 1_040_384_514,
      controller: 3,
      identity: 196_608,
      rank: 0,
      kos: 0,
      falls: 0,
      selfDestructs: 0,
    },
    {
      initial: 1_040_384_771,
      controller: 4,
      identity: 196_608,
      rank: 0,
      kos: 0,
      falls: 0,
      selfDestructs: 0,
    },
  ],
  owners: [0, 1].map((playerNo) => ({
    playerNo,
    stocks: 4_294_967_295,
    damage: 0,
  })),
});

export const brawlResults = BrawlMemorySchema.parse({
  ...brawlPlaying,
  scene: "scVsResult",
  modeRule: 2_148_171_788,
  stage: 2_013_265_960,
  decision: 16_777_216,
  elapsedFrames: 7200,
  remainingFrames: null,
  players: [
    {
      initial: 0,
      controller: 4_278_190_081,
      identity: 0,
      rank: 3_473_665,
      kos: 0,
      falls: 7,
      selfDestructs: 327_680,
    },
    {
      initial: 419_496_193,
      controller: 4_278_452_482,
      identity: 419_496_961,
      rank: 131_072,
      kos: 2,
      falls: 2,
      selfDestructs: 131_074,
    },
    ...brawlPlaying.players.slice(2),
  ],
  owners: [],
});
