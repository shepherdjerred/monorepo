import { type RawMatch, RawMatchSchema } from "#src/league/raw-match.schema.ts";
import type { RawParticipant } from "#src/league/raw-participant.schema.ts";
import { parseTeam } from "#src/model/team.ts";

/**
 * Derives a custom-lobby `RawMatch` from a real one by transformation.
 *
 * Tournament-code lobbies carry a `teamSize` of 1-5, and we have no captured
 * payload for one — nobody can produce a real tournament match until the Riot
 * key has tournament access. Deriving from a genuine Match-V5 DTO (see
 * `testdata/rift.json`) is the closest available approximation, and it is a far
 * better one than hand-authoring a participant: `RawParticipantSchema` has ~170
 * required fields, so a hand-written fixture ends up agreeing with whatever the
 * author assumed rather than with Riot.
 *
 * The result is validated before it is returned, so a fixture that drifts from
 * the schema fails at construction rather than halfway through a test.
 */

const FULL_TEAM_SIZE = 5;

function takeSide(
  participants: RawParticipant[],
  teamId: number,
  count: number,
): RawParticipant[] {
  return participants
    .filter((participant) => participant.teamId === teamId)
    .slice(0, count);
}

function blankPosition(participant: RawParticipant): RawParticipant {
  // Riot reports an empty `teamPosition` for a side that is not a full five —
  // there are no assigned roles to report. `PositionSchema` already accepts "".
  return { ...participant, teamPosition: "", individualPosition: "" };
}

export function toCustomLobby(
  base: RawMatch,
  blueCount: number,
  redCount: number,
): RawMatch {
  if (blueCount < 1 || redCount < 1) {
    throw new Error("a custom lobby needs at least one player per side");
  }
  if (blueCount > FULL_TEAM_SIZE || redCount > FULL_TEAM_SIZE) {
    throw new Error(
      `a side cannot exceed ${FULL_TEAM_SIZE.toString()} players`,
    );
  }

  const blue = takeSide(base.info.participants, 100, blueCount);
  const red = takeSide(base.info.participants, 200, redCount);
  if (blue.length !== blueCount || red.length !== redCount) {
    throw new Error(
      `base match cannot supply ${blueCount.toString()}v${redCount.toString()}: it has ${blue.length.toString()} blue and ${red.length.toString()} red available`,
    );
  }

  const sideIsFull = (count: number) => count === FULL_TEAM_SIZE;
  const participants = [...blue, ...red].map((participant, index) => {
    const isFullSide = sideIsFull(
      parseTeam(participant.teamId) === "blue" ? blueCount : redCount,
    );
    const positioned = isFullSide ? participant : blankPosition(participant);
    return { ...positioned, participantId: index + 1 };
  });

  return RawMatchSchema.parse({
    ...base,
    metadata: {
      ...base.metadata,
      participants: participants.map((participant) => participant.puuid),
    },
    info: {
      ...base.info,
      // queueId 0 is what `parseQueueType` maps to "custom", and gameType
      // CUSTOM_GAME is what `resolveQueueTypeFromGame` keys off when the queue
      // id is one of the ad-hoc values Riot uses for custom lobbies.
      queueId: 0,
      gameType: "CUSTOM_GAME",
      participants,
    },
  });
}
