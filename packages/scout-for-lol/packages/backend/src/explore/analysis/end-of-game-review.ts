import {
  participantKindOf,
  type EndOfGameMatch,
  type EndOfGameParticipant,
  type EndOfGameTeam,
  type LiveGameRecordingPayload,
} from "@scout-for-lol/data";
import { ANALYSIS_OUTPUT_BYTES } from "./model-output.ts";

/**
 * The review input for a game Scout knows only from the League client's
 * end-of-game screen (`local-eog-1`, common for League Classic): the
 * end-of-game participant stats, the team totals the block states, and the
 * asker's own Scout Desktop recording of the game when one was uploaded.
 *
 * There is no Riot timeline, so the input says so by name and carries no
 * event, death position, objective time or team gold over time. What the
 * record does not state (participant numbers, patch, bans, Rift Herald,
 * Voidgrub and Atakhan counts, undecided "first" flags) is marked `unknown`,
 * never zero. A review is the asker's own: only a player in the game is
 * reviewed, and only their own recording is read.
 */

/** A fact the end-of-game record does not state. Never a zero. */
const UNKNOWN = "unknown" as const;

/** Roughly every five minutes of game time, as the recording samples it. */
const CHECKPOINT_INTERVAL_SECONDS = 300;

export const END_OF_GAME_NOT_A_PLAYER_REFUSAL = {
  ok: false as const,
  message:
    "Scout recorded this game only from a player's League client end-of-game screen. That review is available only to a player in the game, about their own game, and none of the asker's linked Riot accounts played in it.",
};

function gameTime(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60).toString()}:${(whole % 60).toString().padStart(2, "0")}`;
}

function position(participant: EndOfGameParticipant) {
  const value = participant.teamPosition;
  return value === "" || value === "Invalid" ? UNKNOWN : value;
}

function orUnknown<T>(value: T | null): T | typeof UNKNOWN {
  return value ?? UNKNOWN;
}

/**
 * The player in this end-of-game record whom the asker may have reviewed: a
 * player (never a bot or unresolved participant) on one of the asker's Riot
 * accounts.
 */
export function endOfGameReviewedPlayer(
  match: EndOfGameMatch,
  askerPuuids: ReadonlySet<string>,
): EndOfGameParticipant | null {
  return (
    match.info.participants.find(
      (participant) =>
        participantKindOf(participant) === "player" &&
        participant.puuid !== null &&
        askerPuuids.has(participant.puuid),
    ) ?? null
  );
}

function rosterEntry(
  participant: EndOfGameParticipant,
  reviewed: EndOfGameParticipant,
) {
  const kind = participantKindOf(participant);
  return {
    kind,
    ...(participant === reviewed ? { reviewed: true } : {}),
    champion: participant.championName,
    teamId: participant.teamId,
    // A bot or unresolved player is listed, but never named as a player.
    ...(kind === "player"
      ? {
          riotIdGameName: participant.riotIdGameName ?? null,
          riotIdTagline: participant.riotIdTagline,
        }
      : {}),
    role: position(participant),
    win: participant.win,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
    gold: participant.goldEarned,
    damage: participant.totalDamageDealtToChampions,
    vision: participant.visionScore,
  };
}

function objective(stated: { first: boolean | null; kills: number | null }) {
  return { kills: orUnknown(stated.kills), first: orUnknown(stated.first) };
}

function teamFacts(team: EndOfGameTeam) {
  const { objectives } = team;
  return {
    teamId: team.teamId,
    win: team.win,
    bans:
      team.bans === null
        ? UNKNOWN
        : team.bans.map((ban) => ({
            championId: ban.championId,
            pickTurn: ban.pickTurn,
          })),
    objectives: {
      champion: objective(objectives.champion),
      tower: objective(objectives.tower),
      inhibitor: objective(objectives.inhibitor),
      dragon: objective(objectives.dragon),
      baron: objective(objectives.baron),
      riftHerald: objective(objectives.riftHerald),
      voidgrubs: objective(objectives.horde),
      atakhan: objective(objectives.atakhan),
    },
  };
}

function playerFacts(
  participant: EndOfGameParticipant,
  durationSeconds: number,
) {
  const cs = participant.totalMinionsKilled + participant.neutralMinionsKilled;
  return {
    champion: participant.championName,
    teamId: participant.teamId,
    role: position(participant),
    win: participant.win,
    champLevel: participant.champLevel,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    cs,
    csPerMinute: Math.round((cs / (durationSeconds / 60)) * 10) / 10,
    gold: participant.goldEarned,
    damageToChampions: participant.totalDamageDealtToChampions,
    damageTaken: participant.totalDamageTaken,
    damageMitigated: participant.damageSelfMitigated,
    turretDamage: participant.damageDealtToTurrets,
    vision: participant.visionScore,
    wardsPlaced: participant.wardsPlaced,
    wardsKilled: participant.wardsKilled,
    controlWardsPlaced: participant.detectorWardsPlaced,
    timeSpentDeadSeconds: participant.totalTimeSpentDead,
    largestMultiKill: participant.largestMultiKill,
    items: [
      participant.item0,
      participant.item1,
      participant.item2,
      participant.item3,
      participant.item4,
      participant.item5,
      participant.item6,
    ],
    summonerSpellIds: [participant.summoner1Id, participant.summoner2Id],
  };
}

type Checkpoint = {
  readonly gameTime: string;
  readonly level: number;
  readonly kills: number;
  readonly deaths: number;
  readonly assists: number;
  readonly cs: number;
};

/**
 * The asker's own progression from their recording: their level, KDA and CS
 * at the first sample past each five-minute mark, and at the last sample. It
 * holds nothing about another player, the team's gold, or any event.
 */
function recordingCheckpoints(
  recording: LiveGameRecordingPayload,
): Checkpoint[] {
  const own = recording.data.samples
    .toSorted((a, b) => a.game_time_secs - b.game_time_secs)
    .flatMap((sample) => {
      const self = sample.snapshot.participants.find((p) => p.is_self);
      return self === undefined
        ? []
        : [
            {
              seconds: sample.game_time_secs,
              checkpoint: {
                gameTime: gameTime(sample.game_time_secs),
                level: self.level,
                kills: self.kills,
                deaths: self.deaths,
                assists: self.assists,
                cs: self.creep_score,
              },
            },
          ];
    });
  const checkpoints: Checkpoint[] = [];
  let nextMark = CHECKPOINT_INTERVAL_SECONDS;
  for (const entry of own) {
    if (entry.seconds < nextMark) continue;
    checkpoints.push(entry.checkpoint);
    nextMark =
      (Math.floor(entry.seconds / CHECKPOINT_INTERVAL_SECONDS) + 1) *
      CHECKPOINT_INTERVAL_SECONDS;
  }
  const last = own.at(-1);
  if (last !== undefined && checkpoints.at(-1) !== last.checkpoint)
    checkpoints.push(last.checkpoint);
  return checkpoints;
}

function recordingFacts(recording: LiveGameRecordingPayload | null) {
  if (recording === null)
    return {
      included: false as const,
      reason:
        "The asker's Scout Desktop uploaded no live recording of this game.",
    };
  return {
    included: true as const,
    source:
      "The asker's own Scout Desktop recording: their own champion as their client saw it, sampled during the game.",
    samples: recording.data.samples.length,
    checkpoints: recordingCheckpoints(recording),
  };
}

/** The end-of-game review input for `reviewed`, within the analysis output limit. */
export function summarizeEndOfGameMatch(input: {
  readonly match: EndOfGameMatch;
  readonly reviewed: EndOfGameParticipant;
  readonly recording: LiveGameRecordingPayload | null;
}) {
  const { match, reviewed } = input;
  if (!match.info.participants.includes(reviewed))
    throw new Error(
      "The reviewed participant is not in this end-of-game record.",
    );
  const { info } = match;
  const result = {
    ok: true as const,
    matchId: match.metadata.matchId,
    coverage: {
      record: "end_of_game" as const,
      riotTimeline: false as const,
      reason:
        "Scout recorded this game from the League client's end-of-game screen; Riot published no match history or timeline for it.",
      liveRecording: input.recording !== null,
    },
    game: {
      durationSeconds: info.gameDuration,
      endedAtMs: info.gameEndTimestamp,
      queueId: info.queueId,
      gameMode: info.gameMode,
      patch: orUnknown(info.gameVersion),
    },
    player: playerFacts(reviewed, info.gameDuration),
    participants: info.participants.map((participant) =>
      rosterEntry(participant, reviewed),
    ),
    teams: info.teams.map((team) => teamFacts(team)),
    liveRecording: recordingFacts(input.recording),
    unknown: [
      "participant numbers",
      "patch",
      "Rift Herald, Voidgrub and Atakhan kills",
      ...(info.teams.some((team) => team.bans === null) ? ["bans"] : []),
      "any 'first' objective the stated counts and player flags cannot decide",
      "the Riot timeline: event order and times, killers and victims of each death, death positions, objective timing, and gold or CS over time for anyone but the asker's own recording",
    ],
    message:
      "This is the whole review input for an end-of-game-only game; there are no further pages and participantId does not apply. There is no Riot timeline: make no laning-phase gold or CS difference claim, no objective timing or order claim, no death position, killer or death sequence claim, and no turning point. A value of 'unknown' was not stated by the record; never treat it as zero or none. liveRecording checkpoints are only the asker's own level, KDA and CS at those game times. Ground every adjustment in these end-of-game totals.",
  };
  // Arena's sixteen players are the largest roster; drop recording
  // checkpoints from the middle before giving up.
  while (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    ANALYSIS_OUTPUT_BYTES
  ) {
    const recording = result.liveRecording;
    if (!recording.included || recording.checkpoints.length <= 2)
      throw new Error(
        "End-of-game review facts exceed the 8 KiB summary limit.",
      );
    recording.checkpoints.splice(
      Math.floor(recording.checkpoints.length / 2),
      1,
    );
  }
  return result;
}
