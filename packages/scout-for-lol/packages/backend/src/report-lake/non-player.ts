import type { RawParticipant } from "@scout-for-lol/data";

/**
 * The lake keys every participant row by Riot PUUID and has no column for a
 * participant's kind yet, so a document naming a bot or an unresolved player
 * has no faithful rows. It is refused at this boundary, loudly, rather than
 * written with rows that misstate who played; a League-client UUID can never
 * reach the lake because only a player row carries a PUUID at all.
 */
export class LakeNonPlayerParticipantError extends Error {
  constructor(
    readonly matchId: string,
    readonly participantIds: readonly number[],
  ) {
    super(
      `Report lake cannot store ${matchId}: participants ${participantIds.join(", ")} are not players`,
    );
    this.name = "LakeNonPlayerParticipantError";
  }
}

type LakeParticipant = Pick<RawParticipant, "participantId" | "puuid">;

/** The participant numbers the lake cannot store, empty when it can. */
export function lakeNonPlayerParticipantIds(
  participants: readonly LakeParticipant[],
): number[] {
  return participants.flatMap((participant) =>
    participant.puuid === null ? [participant.participantId] : [],
  );
}

/** Every participant as a player, or a {@link LakeNonPlayerParticipantError}. */
export function requireLakePlayers<T extends LakeParticipant>(
  matchId: string,
  participants: readonly T[],
): (T & { readonly puuid: NonNullable<T["puuid"]> })[] {
  const players = participants.flatMap((participant) =>
    participant.puuid === null
      ? []
      : [{ ...participant, puuid: participant.puuid }],
  );
  if (players.length !== participants.length) {
    throw new LakeNonPlayerParticipantError(
      matchId,
      lakeNonPlayerParticipantIds(participants),
    );
  }
  return players;
}
