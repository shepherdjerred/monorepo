import { prisma } from "#src/database/index.ts";

type BoundGame = {
  readonly observedLobbyId: string | null;
  readonly lobbyObservationId: string | null;
};

async function boundLobbyCapturedAt(candidate: BoundGame): Promise<Date> {
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
  return source.capturedAt;
}

async function hasDifferentLobbyAfter(
  candidate: BoundGame,
  participantPuuids: readonly string[],
  sourceCapturedAt: Date,
  eventCapturedAt: Date,
): Promise<boolean> {
  const supersedingLobby = await prisma.scoutClientObservation.findFirst({
    where: {
      kind: "lobby",
      disposition: "ACCEPTED",
      localPuuid: { in: [...participantPuuids] },
      lobbyId: { not: candidate.observedLobbyId },
      capturedAt: { gt: sourceCapturedAt, lte: eventCapturedAt },
    },
    select: { observationId: true },
  });
  return supersedingLobby !== null;
}

/** Whether newer accepted lobby evidence invalidates a game's lobby binding. */
export async function lobbyWasSuperseded(
  candidate: BoundGame,
  participantPuuids: readonly string[],
  eventCapturedAt: Date,
): Promise<boolean> {
  const sourceCapturedAt = await boundLobbyCapturedAt(candidate);
  return (
    sourceCapturedAt > eventCapturedAt ||
    (await hasDifferentLobbyAfter(
      candidate,
      participantPuuids,
      sourceCapturedAt,
      eventCapturedAt,
    ))
  );
}

/** Whether a different lobby may replace this binding before play starts. */
export async function lobbyWasRecreatedBefore(
  candidate: BoundGame,
  participantPuuids: readonly string[],
  eventCapturedAt: Date,
): Promise<boolean> {
  const sourceCapturedAt = await boundLobbyCapturedAt(candidate);
  return (
    sourceCapturedAt <= eventCapturedAt &&
    (await hasDifferentLobbyAfter(
      candidate,
      participantPuuids,
      sourceCapturedAt,
      eventCapturedAt,
    ))
  );
}

/** Keep unbound, idempotent, or positively superseded pre-start bindings. */
export async function replaceableLobbyBindings<Game extends BoundGame>(
  games: readonly Game[],
  participantPuuids: (game: Game) => readonly string[],
  observation: { readonly capturedAt: string; readonly lobbyId: string },
): Promise<Game[]> {
  const eligible = [];
  for (const game of games) {
    const isUnbound =
      game.observedLobbyId === null && game.lobbyObservationId === null;
    const isAlreadyBoundToThisLobby =
      game.observedLobbyId === observation.lobbyId &&
      game.lobbyObservationId !== null;
    if (isUnbound) {
      eligible.push(game);
      continue;
    }
    if (isAlreadyBoundToThisLobby) {
      const sourceCapturedAt = await boundLobbyCapturedAt(game);
      if (sourceCapturedAt <= new Date(observation.capturedAt)) {
        eligible.push(game);
      }
      continue;
    }
    if (
      await lobbyWasRecreatedBefore(
        game,
        participantPuuids(game),
        new Date(observation.capturedAt),
      )
    ) {
      eligible.push(game);
    }
  }
  return eligible;
}

/** Remove bindings invalidated by a newer lobby seen before this event. */
export async function withoutSupersededBindings<T extends BoundGame>(
  candidates: readonly T[],
  participantPuuids: (candidate: T) => readonly string[],
  eventCapturedAt: Date,
): Promise<T[]> {
  const eligible = [];
  for (const candidate of candidates) {
    if (
      !(await lobbyWasSuperseded(
        candidate,
        participantPuuids(candidate),
        eventCapturedAt,
      ))
    ) {
      eligible.push(candidate);
    }
  }
  return eligible;
}
