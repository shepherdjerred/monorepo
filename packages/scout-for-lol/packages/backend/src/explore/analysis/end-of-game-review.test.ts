import { describe, expect, test } from "vitest";
import {
  LiveGameRecordingPayloadSchema,
  type EndOfGameMatch,
  type LiveGameRecordingPayload,
} from "@scout-for-lol/data";
import fixtures from "@scout-for-lol/data/scout-client/live-game-recording.fixtures.json" with { type: "json" };
import { classicEndOfGameMatch } from "#src/testing/scout-client/end-of-game-fixtures.ts";
import {
  endOfGameReviewedPlayer,
  summarizeEndOfGameMatch,
} from "./end-of-game-review.ts";

const match = await classicEndOfGameMatch();

function firstPlayer(record: EndOfGameMatch) {
  const player = record.info.participants.find(
    (participant) => participant.puuid !== null,
  );
  if (player?.puuid == null) throw new Error("The Classic game has players");
  return { player, puuid: player.puuid };
}

/** The fixture recording, stretched to a 30-minute game sampled every minute. */
function thirtyMinuteRecording(): LiveGameRecordingPayload {
  const base = LiveGameRecordingPayloadSchema.parse(fixtures.recording);
  const [sample] = base.data.samples;
  if (sample === undefined) throw new Error("The fixture has a sample");
  const samples = Array.from({ length: 31 }, (_, minute) => {
    const seconds = minute * 60;
    return {
      ...sample,
      game_time_secs: seconds,
      snapshot: {
        ...sample.snapshot,
        game: { ...sample.snapshot.game, game_time_secs: seconds },
        participants: sample.snapshot.participants.map((participant) =>
          participant.is_self
            ? {
                ...participant,
                level: Math.min(18, 1 + minute),
                creep_score: minute * 7,
                deaths: Math.floor(minute / 10),
              }
            : participant,
        ),
      },
    };
  });
  return LiveGameRecordingPayloadSchema.parse({
    ...base,
    data: { ...base.data, samples },
  });
}

describe("the end-of-game review input", () => {
  test("is built from the end-of-game stats and labelled as having no Riot timeline", () => {
    const { player } = firstPlayer(match);
    const review = summarizeEndOfGameMatch({
      match,
      reviewed: player,
      recording: null,
    });
    expect(review.coverage).toEqual({
      record: "end_of_game",
      riotTimeline: false,
      reason: expect.stringContaining("end-of-game screen"),
      liveRecording: false,
    });
    expect(review.game).toMatchObject({
      queueId: 4310,
      gameMode: "JADE",
      durationSeconds: match.info.gameDuration,
    });
    expect(review.player).toMatchObject({
      champion: player.championName,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      cs: player.totalMinionsKilled + player.neutralMinionsKilled,
      gold: player.goldEarned,
      vision: player.visionScore,
      win: player.win,
    });
    expect(review.participants).toHaveLength(match.info.participants.length);
    expect(review.participants.filter((entry) => entry.reviewed)).toEqual([
      expect.objectContaining({ champion: player.championName }),
    ]);
    expect(review.liveRecording).toEqual({
      included: false,
      reason: expect.any(String),
    });
    expect(review.message).toContain("no Riot timeline");
  });

  test("marks what the record does not state as unknown, never zero", () => {
    const { player } = firstPlayer(match);
    const review = summarizeEndOfGameMatch({
      match,
      reviewed: player,
      recording: null,
    });
    // The record leaves these null; the review must not turn them into 0.
    expect(match.info.gameVersion).toBeNull();
    expect(review.game.patch).toBe("unknown");
    for (const team of review.teams) {
      expect(team.objectives.riftHerald).toEqual({
        kills: "unknown",
        first: "unknown",
      });
      expect(team.objectives.voidgrubs).toEqual({
        kills: "unknown",
        first: "unknown",
      });
      expect(team.objectives.atakhan).toEqual({
        kills: "unknown",
        first: "unknown",
      });
      // The Classic gameflow states no bans, which is not "no bans".
      expect(team.bans).toBe("unknown");
      expect(typeof team.objectives.tower.kills).toBe("number");
    }
    expect(review.unknown).toEqual(
      expect.arrayContaining(["participant numbers", "patch", "bans"]),
    );
    // Nothing keyed on participant numbers or the timeline reaches the model.
    const text = JSON.stringify(review);
    for (const absent of [
      'participantId":',
      "selectedEvents",
      "precedingGoldSnapshot",
      'position":',
      "frames",
    ])
      expect(text).not.toContain(absent);
  });

  test("a stated first and a stated zero stay as stated", () => {
    const { player } = firstPlayer(match);
    const review = summarizeEndOfGameMatch({
      match,
      reviewed: player,
      recording: null,
    });
    for (const [index, team] of match.info.teams.entries()) {
      expect(review.teams[index]?.objectives.dragon).toEqual({
        kills: team.objectives.dragon.kills,
        first: team.objectives.dragon.first ?? "unknown",
      });
    }
  });

  test("adds the asker's own recording as checkpoints of their own progression", () => {
    const { player } = firstPlayer(match);
    const review = summarizeEndOfGameMatch({
      match,
      reviewed: player,
      recording: thirtyMinuteRecording(),
    });
    expect(review.coverage.liveRecording).toBe(true);
    expect(review.coverage.riotTimeline).toBe(false);
    if (!review.liveRecording.included) throw new Error("Recording included");
    expect(review.liveRecording.samples).toBe(31);
    expect(
      review.liveRecording.checkpoints.map((point) => point.gameTime),
    ).toEqual(["5:00", "10:00", "15:00", "20:00", "25:00", "30:00"]);
    expect(review.liveRecording.checkpoints[1]).toEqual({
      gameTime: "10:00",
      level: 11,
      kills: 2,
      deaths: 1,
      assists: 1,
      cs: 70,
    });
    // Only the asker's own champion: no other player's stats or items.
    expect(JSON.stringify(review.liveRecording)).not.toContain("Lee Sin");
  });

  test("a recording shorter than five minutes keeps its last sample", () => {
    const { player } = firstPlayer(match);
    const review = summarizeEndOfGameMatch({
      match,
      reviewed: player,
      recording: LiveGameRecordingPayloadSchema.parse(fixtures.recording),
    });
    if (!review.liveRecording.included) throw new Error("Recording included");
    expect(review.liveRecording.checkpoints).toEqual([
      expect.objectContaining({ gameTime: "0:06" }),
    ]);
  });

  test("refuses to review a participant from another game", async () => {
    const other = await classicEndOfGameMatch();
    const { player } = firstPlayer(other);
    expect(() =>
      summarizeEndOfGameMatch({ match, reviewed: player, recording: null }),
    ).toThrow(/not in this end-of-game record/);
  });
});

describe("who an end-of-game review is for", () => {
  test("a player in the game on one of the asker's accounts", () => {
    const { player, puuid } = firstPlayer(match);
    expect(endOfGameReviewedPlayer(match, new Set([puuid]))).toBe(player);
  });

  test("nobody, when none of the asker's accounts played", () => {
    expect(endOfGameReviewedPlayer(match, new Set())).toBeNull();
    expect(
      endOfGameReviewedPlayer(match, new Set(["x".repeat(78)])),
    ).toBeNull();
  });

  test("never a bot or an unresolved participant", () => {
    const { puuid } = firstPlayer(match);
    const disguised: EndOfGameMatch = {
      ...match,
      info: {
        ...match.info,
        participants: match.info.participants.map((participant) =>
          participant.puuid === puuid
            ? { ...participant, participantKind: "unresolved" as const }
            : participant,
        ),
      },
    };
    expect(endOfGameReviewedPlayer(disguised, new Set([puuid]))).toBeNull();
  });
});
