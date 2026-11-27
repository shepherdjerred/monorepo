import {
  LeaguePuuidSchema,
  type LeaguePuuid,
  type RawMatchSchema,
} from "@scout-for-lol/data";
import {
  getReplayContainerLayout,
  normalizeGameBuild,
  sameGameBuild,
} from "@scout-for-lol/domain/artifacts/replay-transport.mjs";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import path from "node:path";
import { z } from "zod";

type CanonicalMatch = z.infer<typeof RawMatchSchema>;
type ProofMatch = {
  metadata: Pick<CanonicalMatch["metadata"], "matchId">;
  info: Pick<
    CanonicalMatch["info"],
    "gameId" | "gameMode" | "gameVersion" | "mapId" | "queueId"
  > & {
    participants: readonly Pick<
      CanonicalMatch["info"]["participants"][number],
      | "puuid"
      | "championName"
      | "riotIdGameName"
      | "riotIdTagline"
      | "teamId"
      | "participantId"
      | "kills"
      | "deaths"
      | "assists"
    >[];
  };
};

export type CanonicalProofOwner = { puuid: LeaguePuuid } | { champion: string };

export function canonicalReplayMatchId(gameId: string) {
  return RiotMatchIdSchema.parse(
    `NA1_${z
      .string()
      .regex(/^[1-9]\d*$/u)
      .parse(gameId)}`,
  );
}

export function canonicalReplayRequests<T extends { gameId: string }>(
  games: readonly T[],
  config: {
    matchPath: string | undefined;
    matchDirectory: string | undefined;
    ownerPuuid: string | undefined;
    legacyOwnerChampion: string | undefined;
  },
) {
  if (config.matchPath !== undefined && config.matchDirectory !== undefined)
    throw new Error("Choose only one canonical replay match input");
  if (config.matchDirectory !== undefined) {
    const directory = config.matchDirectory;
    const owner = { puuid: LeaguePuuidSchema.parse(config.ownerPuuid) };
    return games.map((game) => ({
      game,
      owner,
      matchPath: path.join(
        directory,
        `${canonicalReplayMatchId(game.gameId)}.json`,
      ),
    }));
  }
  if (config.matchPath === undefined) return [];
  const [game] = games;
  if (
    game === undefined ||
    games.length !== 1 ||
    config.legacyOwnerChampion === undefined
  )
    throw new Error(
      "A canonical match file requires one game and SCOUT_REPLAY_PROOF_OWNER_CHAMPION",
    );
  return [
    {
      game,
      owner: { champion: config.legacyOwnerChampion },
      matchPath: config.matchPath,
    },
  ];
}

export function readCanonicalReplayEnvelope(bytes: Buffer) {
  const buildLength = bytes[14] ?? 0;
  const headerEnd = 15 + buildLength;
  if (
    buildLength === 0 ||
    buildLength > 64 ||
    bytes.length < headerEnd + 260 ||
    bytes.toString("ascii", 0, 4) !== "RIOT" ||
    bytes.readUInt16LE(4) !== 2
  )
    throw new Error("Invalid replay proof header");
  const gameBuild = normalizeGameBuild(
    bytes.toString("ascii", 15, headerEnd).replace(/\0+$/u, ""),
  );
  if (gameBuild === null) throw new Error("Invalid replay proof build");
  const protocol = bytes.toString("hex", 6, 14);
  getReplayContainerLayout(gameBuild, protocol);
  const footerLength = bytes.readUInt32LE(bytes.length - 4);
  const footerStart = bytes.length - 4 - footerLength;
  if (
    footerLength === 0 ||
    footerLength > 4 * 1024 * 1024 ||
    footerStart < headerEnd + 256
  )
    throw new Error("Invalid replay proof footer bounds");
  try {
    const { statsJson } = z
      .object({ statsJson: z.string() })
      .parse(JSON.parse(bytes.toString("utf8", footerStart, bytes.length - 4)));
    const stats: unknown = JSON.parse(statsJson);
    return { gameBuild, stats };
  } catch {
    throw new Error("Invalid replay proof footer JSON");
  }
}

export function selectCanonicalReplayOwner(
  match: ProofMatch,
  request: { gameId: string; gameBuild: string; queueId: number },
  identity: CanonicalProofOwner,
) {
  const { info } = match;
  if (
    match.metadata.matchId !== canonicalReplayMatchId(request.gameId) ||
    info.gameId.toString() !== request.gameId ||
    info.queueId !== request.queueId ||
    !sameGameBuild(info.gameVersion, request.gameBuild)
  )
    throw new Error(
      "Canonical match differs from the requested replay identity",
    );
  if (
    info.mapId !== 11 ||
    info.gameMode !== "CLASSIC" ||
    info.participants.length !== 10 ||
    new Set(info.participants.map(({ participantId }) => participantId))
      .size !== 10 ||
    [100, 200].some(
      (team) =>
        info.participants.filter(({ teamId }) => teamId === team).length !== 5,
    )
  )
    throw new Error(
      "Canonical replay proof requires a complete Map11 CLASSIC 5v5 roster",
    );
  const owners = info.participants.filter((participant) =>
    "puuid" in identity
      ? participant.puuid === identity.puuid
      : participant.championName === identity.champion,
  );
  const owner = owners.length === 1 ? owners[0] : undefined;
  if (!owner)
    throw new Error("Canonical proof requires a unique owner in the match");
  return owner;
}

const FooterRowsSchema = z.array(
  z.object({
    PUUID: z.string(),
    RIOT_ID_GAME_NAME: z.string(),
    RIOT_ID_TAG_LINE: z.string(),
    SKIN: z.string(),
    TEAM: z.string(),
    CHAMPIONS_KILLED: z.string(),
    NUM_DEATHS: z.string(),
    ASSISTS: z.string(),
  }),
);

export function matchCanonicalReplayFooter(
  stats: unknown,
  owner: ReturnType<typeof selectCanonicalReplayOwner>,
) {
  const parsed = FooterRowsSchema.safeParse(stats);
  if (!parsed.success) throw new Error("Invalid replay proof footer roster");
  const rows = parsed.data.filter(
    (row) =>
      row.RIOT_ID_GAME_NAME === owner.riotIdGameName &&
      row.RIOT_ID_TAG_LINE === owner.riotIdTagline &&
      row.SKIN === owner.championName &&
      row.TEAM === owner.teamId.toString() &&
      row.CHAMPIONS_KILLED === owner.kills.toString() &&
      row.NUM_DEATHS === owner.deaths.toString() &&
      row.ASSISTS === owner.assists.toString(),
  );
  const row = rows.length === 1 ? rows[0] : undefined;
  if (row === undefined)
    throw new Error(
      "Canonical owner cannot be uniquely joined to the replay footer",
    );
  const lcuUuid = z.uuid().safeParse(row.PUUID);
  if (!lcuUuid.success)
    throw new Error("Canonical owner footer row lacks a valid local identity");
  return {
    lcuUuid: lcuUuid.data,
    gameName: row.RIOT_ID_GAME_NAME,
    tagLine: row.RIOT_ID_TAG_LINE,
  };
}
