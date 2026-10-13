import { z } from "zod";
import {
  RawCurrentGameInfoSchema,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";

const SelectionSchema = z.object({
  summonerInternalName: z.string().min(1),
  championId: z.number().int().positive(),
  selectedSkinIndex: z.number().int().nonnegative().optional(),
  spell1Id: z.number().int().nonnegative(),
  spell2Id: z.number().int().nonnegative(),
});
const SessionSourcesSchema = z.object({
  resource: z.literal("gameflow_session"),
  data: z.looseObject({
    gameData: z.looseObject({
      teamOne: z.array(z.record(z.string(), z.unknown())),
      teamTwo: z.array(z.record(z.string(), z.unknown())),
      playerChampionSelections: z.array(SelectionSchema).optional(),
    }),
  }),
});

/** Gameflow roster cosmetics and champion selections are distinct client facts. */
function normalizeGameflowSession(payload: unknown): unknown {
  const parsed = SessionSourcesSchema.safeParse(payload);
  if (!parsed.success) return null;
  const session = parsed.data;
  const game = session.data.gameData;
  const players = [...game.teamOne, ...game.teamTwo];
  const normalize = (player: Record<string, unknown>) => {
    const selections = (game.playerChampionSelections ?? []).filter(
      (selection) =>
        selection.summonerInternalName === player["summonerInternalName"] &&
        selection.championId === player["championId"],
    );
    const unique =
      players.filter(
        (other) =>
          other["summonerInternalName"] === player["summonerInternalName"],
      ).length === 1;
    const selection =
      unique && selections.length === 1 ? selections[0] : undefined;
    const skin =
      player["lastSelectedSkinIndex"] ??
      player["selectedSkinIndex"] ??
      selection?.selectedSkinIndex;
    return {
      ...player,
      selectedSkinIndex: skin,
      spell1Id: player["spell1Id"] ?? selection?.spell1Id,
      spell2Id: player["spell2Id"] ?? selection?.spell2Id,
    };
  };
  return {
    ...session,
    data: {
      ...session.data,
      gameData: {
        ...game,
        teamOne: game.teamOne.map((player) => normalize(player)),
        teamTwo: game.teamTwo.map((player) => normalize(player)),
      },
    },
  };
}

const PlayerSchema = z.object({
  puuid: z.string(),
  championId: z.number().int().positive(),
  spell1Id: z.number().int().nonnegative(),
  spell2Id: z.number().int().nonnegative(),
  selectedSkinIndex: z.number().int().nonnegative(),
  profileIconId: z.number().int().nonnegative(),
  riotId: z.string().optional(),
  gameName: z.string().optional(),
  tagLine: z.string().optional(),
  summonerName: z.string().optional(),
  bot: z.boolean().optional(),
});

const IdentityPlayerSchema = PlayerSchema.pick({
  puuid: true,
  championId: true,
  riotId: true,
  gameName: true,
  tagLine: true,
  summonerName: true,
}).extend({
  spell1Id: z.number().int().nonnegative().optional(),
  spell2Id: z.number().int().nonnegative().optional(),
});
const GameIdentitySchema = z.object({
  gameId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  platformId: z.string().optional(),
});
const IdentitySessionSchema = z.object({
  resource: z.literal("gameflow_session"),
  data: z.object({
    phase: z.enum(["GameStart", "InProgress"]),
    gameData: GameIdentitySchema.extend({
      queue: z.object({ id: z.number().int().nonnegative() }),
      teamOne: z.array(IdentityPlayerSchema),
      teamTwo: z.array(IdentityPlayerSchema),
    }),
  }),
});

type IdentityParticipant = Pick<
  RawCurrentGameInfo["participants"][number],
  "puuid" | "teamId" | "championId" | "riotId"
> & { spell1Id?: number; spell2Id?: number };
export type PrematchIdentityEvidence = Pick<
  RawCurrentGameInfo,
  "gameId" | "platformId" | "gameQueueConfigId"
> & { participants: IdentityParticipant[] };

/** Identity enrichment needs fewer fields than rendering a whole client roster. */
export function parseLocalPrematchIdentities(
  payload: unknown,
  observer: string,
  platform: string,
  gameId: string,
): PrematchIdentityEvidence | null {
  const parsed = IdentitySessionSchema.safeParse(
    normalizeGameflowSession(payload),
  );
  if (!parsed.success) return null;
  const game = parsed.data.data.gameData;
  if (
    game.gameId.toString() !== gameId ||
    (game.platformId !== undefined &&
      game.platformId.toUpperCase() !== platform)
  )
    return null;
  if (
    ![...game.teamOne, ...game.teamTwo].some(
      (player) => player.puuid === observer,
    )
  )
    return null;
  return {
    gameId: game.gameId,
    platformId: platform,
    gameQueueConfigId: game.queue.id,
    participants: [game.teamOne, game.teamTwo].flatMap((players, index) =>
      players.map((player) => ({
        championId: player.championId,
        teamId: index === 0 ? 100 : 200,
        puuid: player.puuid.length === 78 ? player.puuid : null,
        ...(player.spell1Id === undefined ? {} : { spell1Id: player.spell1Id }),
        ...(player.spell2Id === undefined ? {} : { spell2Id: player.spell2Id }),
        riotId:
          player.riotId ??
          (player.gameName !== undefined && player.tagLine !== undefined
            ? `${player.gameName}#${player.tagLine}`
            : (player.summonerName ?? "")),
      })),
    ),
  };
}
const SessionSchema = z.object({
  resource: z.literal("gameflow_session"),
  data: z.object({
    phase: z.enum(["GameStart", "InProgress"]),
    gameData: GameIdentitySchema.extend({
      gameStartTime: z.number().nonnegative().optional(),
      gameLength: z.number().optional(),
      gameMode: z.string().optional(),
      gameType: z.string().optional(),
      isCustomGame: z.boolean().optional(),
      teamOne: z.array(PlayerSchema),
      teamTwo: z.array(PlayerSchema),
      queue: z.object({
        id: z.number().int().nonnegative(),
        gameMode: z.string().optional(),
        gameType: z.string().optional(),
        mapId: z.number().int().positive(),
      }),
      bannedChampions: z.array(
        z.object({
          championId: z.number(),
          teamId: z.number(),
          pickTurn: z.number(),
        }),
      ),
    }),
  }),
});

/** An observed started roster, never a champion-select prediction. */
export function parseLocalPrematch(
  payload: unknown,
  observer: string,
  platform: string,
  gameId: string,
): RawCurrentGameInfo | null {
  const parsed = SessionSchema.safeParse(normalizeGameflowSession(payload));
  if (!parsed.success) return null;
  const session = parsed.data.data;
  const game = session.gameData;
  if (
    game.gameId.toString() !== gameId ||
    (game.platformId !== undefined &&
      game.platformId.toUpperCase() !== platform)
  )
    return null;
  if (
    ![...game.teamOne, ...game.teamTwo].some(
      (player) => player.puuid === observer,
    )
  )
    return null;
  if (game.teamOne.length === 0 || game.teamTwo.length === 0) return null;
  const participants = [game.teamOne, game.teamTwo].flatMap((players, index) =>
    players.map((player) => ({
      championId: player.championId,
      teamId: index === 0 ? 100 : 200,
      puuid: player.puuid.length === 78 ? player.puuid : null,
      riotId:
        player.riotId ??
        (player.gameName !== undefined && player.tagLine !== undefined
          ? `${player.gameName}#${player.tagLine}`
          : (player.summonerName ?? "")),
      spell1Id: player.spell1Id,
      spell2Id: player.spell2Id,
      lastSelectedSkinIndex: player.selectedSkinIndex,
      bot:
        player.bot === true ||
        player.puuid === "00000000-0000-0000-0000-000000000000",
      profileIconId: player.profileIconId,
    })),
  );
  const result = RawCurrentGameInfoSchema.safeParse({
    gameId: game.gameId,
    platformId: platform,
    // Spectator's own sentinels: start 0 means unknown; negative length means loading.
    gameStartTime: game.gameStartTime ?? 0,
    gameLength: game.gameLength ?? (session.phase === "InProgress" ? 0 : -1),
    gameMode: game.gameMode ?? game.queue.gameMode,
    gameType:
      game.isCustomGame === true
        ? "CUSTOM_GAME"
        : (game.gameType ?? game.queue.gameType),
    mapId: game.queue.mapId,
    gameQueueConfigId: game.queue.id,
    participants,
    bannedChampions: game.bannedChampions,
  });
  return result.success ? result.data : null;
}

/** Only unambiguous, matching slots can unmask a privacy-scrubbed identity. */
export function enrichPrematch(
  riot: RawCurrentGameInfo,
  client: PrematchIdentityEvidence | null,
): RawCurrentGameInfo {
  if (
    client?.platformId !== riot.platformId ||
    client.gameId !== riot.gameId ||
    client.gameQueueConfigId !== riot.gameQueueConfigId
  )
    return riot;
  const evidence = z
    .object({
      scoutClientEvidence: z.object({
        observationId: z.string(),
        capturedAt: z.iso.datetime(),
      }),
    })
    .safeParse(client);
  return {
    ...riot,
    ...(evidence.success ? evidence.data : {}),
    participants: riot.participants.map((player) => {
      if (player.puuid !== null) return player;
      const candidates = client.participants.filter((other) =>
        samePrematchSlot(player, other),
      );
      const candidate = candidates[0];
      return candidate !== undefined &&
        candidate.puuid !== null &&
        riot.participants.filter((other) => samePrematchSlot(other, candidate))
          .length === 1 &&
        candidates.length === 1 &&
        !riot.participants.some((other) => other.puuid === candidate.puuid)
        ? {
            ...player,
            puuid: candidate.puuid,
            riotId:
              candidate.riotId.length === 0 ? player.riotId : candidate.riotId,
          }
        : player;
    }),
  };
}

function samePrematchSlot(
  riot: RawCurrentGameInfo["participants"][number],
  client: IdentityParticipant,
): boolean {
  return (
    riot.teamId === client.teamId &&
    riot.championId === client.championId &&
    (client.spell1Id === undefined || client.spell1Id === riot.spell1Id) &&
    (client.spell2Id === undefined || client.spell2Id === riot.spell2Id)
  );
}
