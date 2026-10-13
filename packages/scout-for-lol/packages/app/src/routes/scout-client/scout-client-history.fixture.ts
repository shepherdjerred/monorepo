import { RiotMatchIdSchema } from "@scout-for-lol/data";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

export const recoveredGamesFixture: RouterOutputs["scoutClient"]["results"] = {
  results: [
    {
      matchId: RiotMatchIdSchema.parse("NA1_7101"),
      source: "SCOUT_CLIENT",
      sourceId: "fixture-result",
      queueId: 0,
      gameMode: "CLASSIC",
      gameType: "CUSTOM_GAME",
      gameCreation: Date.parse("2026-10-10T20:00:00Z"),
      durationSeconds: 1800,
      participants: [
        {
          participantId: 1,
          teamId: 100,
          championId: 103,
          identity: {
            kind: "local",
            uuid: "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e",
          },
          name: "River Scout",
          win: true,
          kills: 0,
          deaths: null,
          assists: 2,
          gold: 12_000,
          damageToChampions: null,
          minions: 165,
          level: 16,
        },
        {
          participantId: 2,
          teamId: 200,
          championId: 157,
          identity: { kind: "unresolved" },
          name: null,
          win: false,
          kills: 2,
          deaths: 0,
          assists: null,
          gold: null,
          damageToChampions: 18_000,
          minions: null,
          level: null,
        },
      ],
    },
  ],
  conflicts: [
    {
      matchId: RiotMatchIdSchema.parse("NA1_7102"),
      sourceIds: ["fixture-conflict-a", "fixture-conflict-b"],
    },
  ],
};
