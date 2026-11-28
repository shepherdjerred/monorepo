import {
  LeaguePuuidSchema,
  type LeaguePuuid,
  type Rank,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import {
  LiveRecentFormMapSchema,
  LiveRosterParticipantsSchema,
  type LiveRecentFormMap,
  type LiveRosterParticipant,
} from "#src/live-roster/live-roster-schema.ts";

/**
 * A game in progress for the Live game pages: one of the audit's friends on
 * Ahri in mid against Syndra, six minutes in, with a rank for everyone and a
 * recent-form summary for the strangers Scout read. Kept apart from the other
 * audit fixtures so it can be reasoned about, and changed, on its own.
 */

/** The match id the design audit opens; the audit's route table names it too. */
export const DESIGN_AUDIT_LIVE_MATCH_ID =
  RiotMatchIdSchema.parse("NA1_5500000777");

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** How far into the game the audit lobby is. */
const GAME_AGE_MINUTES = 6;
/** The roster outlives its live window by an hour, as the retention module sets it. */
const ROSTER_LIFETIME_HOURS = 4;

type Seat = {
  riotId: string;
  teamId: 100 | 200;
  championId: number;
  lane: LiveRosterParticipant["lane"];
  spells: readonly [number, number];
  keystoneId: number;
  rank: Rank | null;
};

function rank(
  tier: Rank["tier"],
  division: Rank["division"],
  lp: number,
): Rank {
  return { tier, division, lp, wins: 80, losses: 70 };
}

const FLASH = 4;
const IGNITE = 14;
const SMITE = 11;
const TELEPORT = 12;
const HEAL = 7;
const GHOST = 6;
const CONQUEROR = 8010;
const ELECTROCUTE = 8112;
const HAIL_OF_BLADES = 9923;
const FLEET_FOOTWORK = 8021;
const AFTERSHOCK = 8439;
const FIRST_STRIKE = 8369;
const PRESS_THE_ATTACK = 8005;

/** The friend's seat: index 2, Ahri in mid. */
const FRIEND_SEAT = 2;

/** Champion ids are Riot's: Garen 86, Vi 254, Ahri 103 and so on. */
const SEATS: readonly Seat[] = [
  {
    riotId: "Ironbark#NA1",
    teamId: 100,
    championId: 86,
    lane: "top",
    spells: [FLASH, IGNITE],
    keystoneId: CONQUEROR,
    rank: rank("emerald", 3, 40),
  },
  {
    riotId: "Sundial#4410",
    teamId: 100,
    championId: 254,
    lane: "jungle",
    spells: [FLASH, SMITE],
    keystoneId: HAIL_OF_BLADES,
    rank: null,
  },
  {
    riotId: "Quillon#QRTZ",
    teamId: 100,
    championId: 103,
    lane: "middle",
    spells: [FLASH, TELEPORT],
    keystoneId: ELECTROCUTE,
    rank: rank("emerald", 1, 22),
  },
  {
    riotId: "Marigold#NA1",
    teamId: 100,
    championId: 51,
    lane: "adc",
    spells: [FLASH, HEAL],
    keystoneId: FLEET_FOOTWORK,
    rank: null,
  },
  {
    riotId: "Tumbledown#NA1",
    teamId: 100,
    championId: 89,
    lane: "support",
    spells: [FLASH, IGNITE],
    keystoneId: AFTERSHOCK,
    rank: null,
  },
  {
    riotId: "Cinderpaw#NA1",
    teamId: 200,
    championId: 122,
    lane: "top",
    spells: [FLASH, GHOST],
    keystoneId: CONQUEROR,
    rank: null,
  },
  {
    riotId: "Hushwing#OWL",
    teamId: 200,
    championId: 234,
    lane: "jungle",
    spells: [FLASH, SMITE],
    keystoneId: CONQUEROR,
    rank: null,
  },
  {
    riotId: "Lowtide#NA1",
    teamId: 200,
    championId: 134,
    lane: "middle",
    spells: [FLASH, IGNITE],
    keystoneId: FIRST_STRIKE,
    rank: null,
  },
  {
    riotId: "Brassfinch#NA1",
    teamId: 200,
    championId: 81,
    lane: "adc",
    spells: [FLASH, HEAL],
    keystoneId: PRESS_THE_ATTACK,
    rank: null,
  },
  {
    riotId: "Oddfellow#NA1",
    teamId: 200,
    championId: 111,
    lane: "support",
    spells: [FLASH, IGNITE],
    keystoneId: AFTERSHOCK,
    rank: null,
  },
];

/** The ranks Scout read for the strangers, by seat. */
const READ_RANKS: Readonly<Record<number, Rank>> = {
  1: rank("emerald", 2, 12),
  3: rank("emerald", 2, 60),
  4: rank("platinum", 1, 90),
  5: rank("emerald", 2, 33),
  6: rank("emerald", 1, 75),
  7: rank("emerald", 3, 10),
  8: rank("emerald", 4, 5),
  9: rank("diamond", 4, 0),
};

/** A stranger's puuid: stable, and never one of the audit's tracked accounts. */
function strangerPuuid(seat: number): LeaguePuuid {
  return LeaguePuuidSchema.parse(
    `live-seat-${seat.toString()}`.padEnd(78, "x"),
  );
}

/**
 * The roster and recent form for the audit lobby, parsed through the same
 * schemas the writer and every reader use. Hushwing is on a five-game win
 * streak and Lowtide has not played Syndra lately: the two lines "Who to
 * watch" shows.
 */
export function buildDesignAuditLiveRoster(input: {
  friendPuuid: LeaguePuuid;
  fetchedAt: Date;
}): {
  participants: LiveRosterParticipant[];
  recentForm: LiveRecentFormMap;
  trackedPuuids: LeaguePuuid[];
} {
  const participants = LiveRosterParticipantsSchema.parse(
    SEATS.map((seat, index) => ({
      puuid: index === FRIEND_SEAT ? input.friendPuuid : strangerPuuid(index),
      riotId: seat.riotId,
      teamId: seat.teamId,
      championId: seat.championId,
      spell1Id: seat.spells[0],
      spell2Id: seat.spells[1],
      keystoneId: seat.keystoneId,
      primaryTreeId: null,
      secondaryTreeId: null,
      lane: seat.lane,
      rank: seat.rank,
      isTracked: index === FRIEND_SEAT,
    })),
  );
  const fetchedAt = input.fetchedAt.toISOString();
  const fetched = (
    seat: number,
    form: {
      games: number;
      wins: number;
      streak: number | null;
      onChampion: readonly [number, number];
    },
  ) =>
    [
      strangerPuuid(seat),
      {
        status: "fetched",
        games: form.games,
        wins: form.wins,
        streak:
          form.streak === null ? null : { result: "win", length: form.streak },
        gamesOnChampion: form.onChampion[0],
        winsOnChampion: form.onChampion[1],
        rank: READ_RANKS[seat] ?? null,
        fetchedAt,
      },
    ] as const;
  const recentForm = LiveRecentFormMapSchema.parse(
    Object.fromEntries([
      ...[1, 3, 4, 5, 9].map((seat) =>
        fetched(seat, { games: 5, wins: 3, streak: null, onChampion: [2, 1] }),
      ),
      fetched(6, { games: 5, wins: 5, streak: 5, onChampion: [4, 3] }),
      fetched(7, { games: 5, wins: 2, streak: null, onChampion: [0, 0] }),
      fetched(8, { games: 5, wins: 3, streak: null, onChampion: [3, 1] }),
    ]),
  );
  return { participants, recentForm, trackedPuuids: [input.friendPuuid] };
}

/**
 * Replace the audit's live game with a fresh one. It is dated from the seed
 * run, not the audit's fixed day: a game is live for three hours after it is
 * detected, so a fixed date would be gone before anyone looked.
 */
export async function seedDesignAuditLiveGame(input: {
  prisma: PrismaClient;
  friendPuuid: LeaguePuuid;
  now: Date;
}): Promise<void> {
  const roster = buildDesignAuditLiveRoster({
    friendPuuid: input.friendPuuid,
    fetchedAt: input.now,
  });
  const startedAt = new Date(
    input.now.getTime() - GAME_AGE_MINUTES * MINUTE_MS,
  );
  await input.prisma.liveGameRoster.deleteMany({
    where: { riotMatchId: DESIGN_AUDIT_LIVE_MATCH_ID },
  });
  await input.prisma.liveGameRoster.create({
    data: {
      riotMatchId: DESIGN_AUDIT_LIVE_MATCH_ID,
      platform: "NA1",
      gameId: DESIGN_AUDIT_LIVE_MATCH_ID.replace("NA1_", ""),
      queueId: 420,
      gameMode: "CLASSIC",
      gameStartedAt: startedAt,
      detectedAt: input.now,
      expiresAt: new Date(
        input.now.getTime() + ROSTER_LIFETIME_HOURS * HOUR_MS,
      ),
      participants: roster.participants,
      trackedPuuids: roster.trackedPuuids,
      recentForm: roster.recentForm,
      recentFormCompletedAt: input.now,
    },
  });
}
