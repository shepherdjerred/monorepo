import { z } from "zod";
import {
  RawMatchSchema,
  type RawMatch,
  RawTimelineSchema,
  type RawTimeline,
  type RawTimelineEvent,
} from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { ANALYSIS_OUTPUT_BYTES } from "./model-output.ts";

function gameTime(timestampMs: number) {
  const seconds = Math.floor(timestampMs / 1000);
  return `${Math.floor(seconds / 60).toString()}:${(seconds % 60).toString().padStart(2, "0")}`;
}

const DocumentsSchema = z.object({
  documents: z.array(
    z.object({
      matchId: RiotMatchIdSchema,
      kind: z.enum(["match", "prematch", "timeline"]),
      document: z.json(),
    }),
  ),
});

function roster(match: RawMatch) {
  return match.info.participants.map((p) => ({
    participantId: p.participantId,
    champion: p.championName,
    teamId: p.teamId,
    riotIdGameName: p.riotIdGameName ?? null,
    riotIdTagline: p.riotIdTagline,
    role: p.teamPosition,
    win: p.win,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    gold: p.goldEarned,
    damage: p.totalDamageDealtToChampions,
    vision: p.visionScore,
  }));
}

function participant(match: RawMatch, id: number | undefined) {
  if (id === undefined || id === 0) return null;
  const found = match.info.participants.find((p) => p.participantId === id);
  if (found === undefined)
    throw new Error(
      `Timeline references unknown participant ${id.toString()}.`,
    );
  return {
    participantId: id,
    champion: found.championName,
    teamId: found.teamId,
  };
}

function teamGoldAt(
  timeline: RawTimeline,
  match: RawMatch,
  teamId: number,
  timestamp: number,
) {
  const frame = timeline.info.frames.findLast((f) => f.timestamp <= timestamp);
  if (!frame?.participantFrames) return null;
  if (new Set(match.info.participants.map((p) => p.teamId)).size !== 2)
    return null;
  let difference = 0;
  for (const p of match.info.participants) {
    const state = frame.participantFrames[p.participantId.toString()];
    if (state === undefined)
      throw new Error("Timeline gold snapshot is missing a match participant.");
    difference += (p.teamId === teamId ? 1 : -1) * state.totalGold;
  }
  return {
    frameTimestampMs: frame.timestamp,
    gameTime: gameTime(frame.timestamp),
    teamGoldDifference: difference,
  };
}

function eventFacts(
  event: RawTimelineEvent,
  match: RawMatch,
  timeline: RawTimeline,
  targetTeam: number,
) {
  if (
    event.type === "CHAMPION_KILL" &&
    (event.killerId === undefined || event.victimId === undefined)
  )
    throw new Error("Champion kill event lacks killer or victim identity.");
  return {
    timestampMs: event.timestamp,
    gameTime: gameTime(event.timestamp),
    type: event.type,
    killer: participant(match, event.killerId),
    victim: participant(match, event.victimId),
    killerTeamId: event.killerTeamId ?? null,
    buildingTeamId: event.teamId ?? null,
    monster: event.monsterType ?? null,
    monsterSubtype: event.monsterSubType ?? null,
    building: event.buildingType ?? null,
    lane: event.laneType ?? null,
    position: event.position ?? null,
    bounty: event.bounty ?? null,
    shutdownBounty: event.shutdownBounty ?? null,
    precedingGoldSnapshot: teamGoldAt(
      timeline,
      match,
      targetTeam,
      event.timestamp,
    ),
  };
}

function timelineCoverage(
  timeline: RawTimeline | null,
  match: RawMatch,
  participantId: number,
) {
  if (timeline === null)
    return {
      state: "missing" as const,
      reason: "No stored timeline document.",
    };
  const frames = timeline.info.frames;
  if (
    frames.some(
      (frame, index) =>
        index > 0 && frame.timestamp < (frames[index - 1]?.timestamp ?? 0),
    )
  )
    throw new Error("Timeline frames are not ordered.");
  const first = frames[0]?.timestamp;
  const last = frames.at(-1)?.timestamp;
  const ids = new Set(timeline.info.participants.map((p) => p.participantId));
  const target = match.info.participants.find(
    (p) => p.participantId === participantId,
  );
  const deaths = frames
    .flatMap((f) => f.events)
    .filter(
      (e) => e.type === "CHAMPION_KILL" && e.victimId === participantId,
    ).length;
  const complete =
    first !== undefined &&
    first <= timeline.info.frameInterval &&
    last !== undefined &&
    last >= match.info.gameDuration * 1000 - timeline.info.frameInterval &&
    match.info.participants.every((p) => ids.has(p.participantId)) &&
    frames.every(
      (frame, index) =>
        index === 0 ||
        frame.timestamp - (frames[index - 1]?.timestamp ?? 0) <=
          // Riot frame timestamps include capture jitter; a missing whole
          // frame produces a gap near two intervals, not a few milliseconds.
          timeline.info.frameInterval * 1.5,
    ) &&
    deaths === target?.deaths;
  return {
    state: complete ? ("complete" as const) : ("partial" as const),
    reason: complete
      ? null
      : "Stored frames, participant coverage or observed deaths do not cover the complete postmatch record.",
  };
}

/** Deterministic facts for a selected game; never infers gameplay causes. */
export function summarizeRecordedMatch(
  data: unknown,
  matchId: RiotMatchId,
  participantId: number,
  offset: number,
) {
  const documents = DocumentsSchema.parse(data).documents.filter(
    (d) => d.matchId === matchId,
  );
  const rawMatch = documents.find((d) => d.kind === "match");
  if (rawMatch === undefined)
    return {
      ok: false as const,
      message: "This dataset has no raw match document for the selected game.",
    };
  const match = RawMatchSchema.parse(rawMatch.document);
  if (match.metadata.matchId !== matchId)
    throw new Error("Raw match identity differs from the selected game.");
  if (
    new Set(match.info.participants.map((p) => p.participantId)).size !==
    match.info.participants.length
  )
    throw new Error("Match participant IDs are not unique.");
  const target = match.info.participants.find(
    (p) => p.participantId === participantId,
  );
  if (target === undefined)
    return {
      ok: false as const,
      message:
        "That participant ID is absent from the selected match; query participant_id for the reviewed player.",
    };
  const rawTimeline = documents.find((d) => d.kind === "timeline");
  const timeline =
    rawTimeline === undefined
      ? null
      : RawTimelineSchema.parse(rawTimeline.document);
  if (timeline !== null && timeline.metadata.matchId !== matchId)
    throw new Error("Raw timeline identity differs from the selected game.");
  const events =
    timeline?.info.frames.flatMap((frame, frameIndex) =>
      frame.events.map((event, eventIndex) => ({
        event,
        frameIndex,
        eventIndex,
      })),
    ) ?? [];
  const coverage = timelineCoverage(timeline, match, participantId);
  const selected = events
    .filter(
      ({ event }) =>
        (event.type === "CHAMPION_KILL" && event.victimId === participantId) ||
        event.type === "ELITE_MONSTER_KILL" ||
        event.type === "BUILDING_KILL",
    )
    .toSorted(
      (a, b) =>
        a.event.timestamp - b.event.timestamp ||
        a.frameIndex - b.frameIndex ||
        a.eventIndex - b.eventIndex,
    );
  const result = {
    ok: true as const,
    matchId,
    participantId,
    game: {
      durationSeconds: match.info.gameDuration,
      createdAtMs: match.info.gameCreation,
      queueId: match.info.queueId,
      patch: match.info.gameVersion,
    },
    participants: roster(match),
    player: {
      champion: target.championName,
      teamId: target.teamId,
      turretDamage: target.damageDealtToTurrets,
      timeSpentDeadSeconds: target.totalTimeSpentDead,
    },
    coverage: {
      prematch: documents.some((d) => d.kind === "prematch"),
      timeline: coverage.state,
      reason: coverage.reason,
      frames: timeline?.info.frames.length ?? null,
      events: timeline === null ? null : events.length,
      participants: timeline?.info.participants.length ?? null,
    },
    selectedEvents: {
      total: timeline === null ? null : selected.length,
      nextOffset: offset + 10 < selected.length ? offset + 10 : null,
      items:
        timeline === null
          ? []
          : selected
              .slice(offset, offset + 10)
              .map(({ event }) =>
                eventFacts(event, match, timeline, target.teamId),
              ),
    },
    message:
      "Facts are observed records. Use the provided gameTime labels verbatim. Gold snapshots precede events and do not establish causation. Shutdown claims require positive shutdownBounty; null is unknown. Event pages include this player's deaths plus objectives; follow nextOffset for the complete sequence. Preserve champion names exactly. Missing prematch data does not imply missing timeline data.",
  };
  while (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    ANALYSIS_OUTPUT_BYTES
  ) {
    if (result.selectedEvents.items.length <= 1)
      throw new Error("Match facts exceed the 8 KiB summary limit.");
    result.selectedEvents.items.pop();
    result.selectedEvents.nextOffset =
      offset + result.selectedEvents.items.length;
  }
  return result;
}
