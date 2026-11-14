import { RawMatchSchema, SCOUT_CLIENT_DATA_VERSION } from "@scout-for-lol/data";

/** The match with its first participant replaced by a bot, as a client reports it. */
export function withFirstParticipantAsBot(
  fixture: ReturnType<typeof RawMatchSchema.parse>,
): ReturnType<typeof RawMatchSchema.parse> {
  const participants = fixture.info.participants.map((participant, index) =>
    index === 0
      ? { ...participant, puuid: null, participantKind: "bot" as const }
      : { ...participant, participantKind: "player" as const },
  );
  return RawMatchSchema.parse({
    metadata: {
      ...fixture.metadata,
      dataVersion: SCOUT_CLIENT_DATA_VERSION,
      participants: participants.flatMap((participant) =>
        participant.puuid === null ? [] : [participant.puuid],
      ),
    },
    info: { ...fixture.info, participants },
  });
}
