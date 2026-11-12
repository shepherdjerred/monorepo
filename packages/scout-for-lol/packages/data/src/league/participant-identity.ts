import type { ParticipantIdentity } from "@scout-for-lol/domain/artifacts/game-result.ts";
import { z } from "zod";

/** Riot's PUUID length: the only identity a player row may carry. */
export const RIOT_PUUID_LENGTH = 78;

/**
 * Who a Match-V5 participant row names.
 *
 * Riot documents name players only and never state a kind. A Scout-built
 * document states one for every row: League's own data also fields bots, and
 * players whose League-client UUID has no Riot alias yet.
 */
export const ParticipantKindSchema = z.enum(["player", "bot", "unresolved"]);
export type ParticipantKind = z.infer<typeof ParticipantKindSchema>;

/** The identity half of a stored participant row, in a match or a timeline. */
export const StoredParticipantIdentitySchema = z.object({
  puuid: z.string().nullable(),
  participantKind: ParticipantKindSchema.optional(),
  leagueClientUuid: z.uuid().optional(),
});
export type StoredParticipantIdentity = z.input<
  typeof StoredParticipantIdentitySchema
>;

/**
 * The kind a validated row names. A row without a stated kind is a player: a
 * Riot document states none, and a Scout-built document written before kinds
 * existed was refused unless every row was a Riot PUUID.
 */
export function participantKindOf(
  participant: StoredParticipantIdentity,
): ParticipantKind {
  return participant.participantKind ?? "player";
}

/** A validated row in the shared identity vocabulary of Scout results. */
export function participantIdentityOf(
  participant: StoredParticipantIdentity,
): ParticipantIdentity {
  const kind = participantKindOf(participant);
  if (kind === "bot") return { kind: "bot" };
  if (kind === "unresolved") {
    return participant.leagueClientUuid === undefined
      ? { kind: "unresolved" }
      : { kind: "local", uuid: participant.leagueClientUuid };
  }
  if (participant.puuid === null) {
    throw new Error("A player row has no PUUID; validate the document first");
  }
  return { kind: "riot", puuid: participant.puuid };
}

/**
 * Whether two validated rows name the same participant identity: the same
 * kind, PUUID and League-client UUID. Two bots compare equal, so a caller
 * pairing rows must also pair them by participant number or team.
 */
export function sameStoredIdentity(
  first: StoredParticipantIdentity,
  second: StoredParticipantIdentity,
): boolean {
  return (
    participantKindOf(first) === participantKindOf(second) &&
    first.puuid === second.puuid &&
    first.leagueClientUuid === second.leagueClientUuid
  );
}

/**
 * The stored identity fields of a Scout-built row. Only a player carries a
 * PUUID; an unresolved player keeps its League-client UUID out of `puuid`, so
 * no reader can mistake it for a Riot identity, and a later alias can resolve
 * it when the document is rebuilt.
 */
export function storedParticipantIdentity(
  identity: ParticipantIdentity,
): StoredParticipantIdentity & { participantKind: ParticipantKind } {
  switch (identity.kind) {
    case "riot": {
      return { puuid: identity.puuid, participantKind: "player" };
    }
    case "bot": {
      return { puuid: null, participantKind: "bot" };
    }
    case "local": {
      return {
        puuid: null,
        participantKind: "unresolved",
        leagueClientUuid: identity.uuid,
      };
    }
    case "unresolved": {
      return { puuid: null, participantKind: "unresolved" };
    }
  }
}

/**
 * Why a row's identity breaks the stored contract, or `null` when it holds.
 * `puuid` is non-null exactly when the row names a player, so every reader
 * that skips a null PUUID skips bots and unresolved players alike.
 */
export function storedIdentityIssue(
  participant: StoredParticipantIdentity,
  scoutBuilt: boolean,
): string | null {
  if (
    !scoutBuilt &&
    (participant.participantKind !== undefined ||
      participant.leagueClientUuid !== undefined)
  ) {
    return "A Riot document names players only and states no participant kind";
  }
  switch (participantKindOf(participant)) {
    case "player": {
      return participant.puuid?.length === RIOT_PUUID_LENGTH &&
        participant.leagueClientUuid === undefined
        ? null
        : "A player row requires a 78-character Riot PUUID";
    }
    case "bot": {
      return participant.puuid === null &&
        participant.leagueClientUuid === undefined
        ? null
        : "A bot row carries no identity";
    }
    case "unresolved": {
      return participant.puuid === null
        ? null
        : "An unresolved row carries no PUUID";
    }
  }
}

/** Refinement shared by the match and timeline documents. */
export function checkStoredIdentities(
  document: {
    readonly scoutBuilt: boolean;
    readonly metadataParticipants: readonly string[];
    readonly participants: readonly StoredParticipantIdentity[];
  },
  ctx: z.RefinementCtx,
): void {
  for (const [index, participant] of document.participants.entries()) {
    const issue = storedIdentityIssue(participant, document.scoutBuilt);
    if (issue !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["info", "participants", index, "puuid"],
        message: issue,
      });
    }
  }
  if (!document.scoutBuilt) return;
  // Set-membership readers (competitions, Dares, Hall, challenges) read the
  // metadata list, so it names exactly the players and nobody else.
  const players = document.participants.flatMap((participant) =>
    participant.puuid === null ? [] : [participant.puuid],
  );
  if (
    players.length !== document.metadataParticipants.length ||
    players.some(
      (puuid, index) => document.metadataParticipants[index] !== puuid,
    )
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["metadata", "participants"],
      message: "A Scout-built document lists exactly its players' PUUIDs",
    });
  }
}
