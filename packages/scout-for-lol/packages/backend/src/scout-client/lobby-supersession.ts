import { prisma } from "#src/database/index.ts";

/** Whether newer accepted lobby evidence invalidates a game's lobby binding. */
export async function lobbyWasSuperseded(
  candidate: {
    readonly observedLobbyId: string | null;
    readonly lobbyObservationId: string | null;
  },
  participantPuuids: string[],
  eventCapturedAt: Date,
): Promise<boolean> {
  if (
    candidate.observedLobbyId === null ||
    candidate.lobbyObservationId === null
  ) {
    throw new Error("Bound Scout game is missing its source lobby evidence");
  }
  const source = await prisma.scoutClientObservation.findUnique({
    where: { observationId: candidate.lobbyObservationId },
    select: { capturedAt: true },
  });
  if (source === null) {
    throw new Error(
      `Bound Scout lobby observation ${candidate.lobbyObservationId} does not exist`,
    );
  }
  if (source.capturedAt > eventCapturedAt) return true;
  const supersedingLobby = await prisma.scoutClientObservation.findFirst({
    where: {
      kind: "lobby",
      disposition: "ACCEPTED",
      localPuuid: { in: participantPuuids },
      lobbyId: { not: candidate.observedLobbyId },
      capturedAt: { gt: source.capturedAt, lte: eventCapturedAt },
    },
    select: { observationId: true },
  });
  return supersedingLobby !== null;
}
