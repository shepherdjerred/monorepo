import { CustomNightSnapshotSchema } from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { cleanupCustomVoice } from "#src/customs/voice.ts";
import { transitionCustomGame } from "#src/customs/game-machine.ts";
import { transitionCustomNight } from "#src/customs/night-machine.ts";
import { importCustomMatchDetails } from "#src/customs/match-import.ts";
import {
  commitCustomMutation,
  getCustomNight,
} from "#src/customs/repository.ts";
import {
  provisionCustomTournamentCode,
  recordRiotTournamentResult,
} from "#src/customs/riot-results.ts";
import { getTournamentGames } from "#src/customs/riot-tournament.ts";
import {
  hasActiveTournamentCodeProvisioning,
  hasActiveVoiceArrangementProvisioning,
  markOverdueAway,
  shouldExpireCustomNight,
} from "#src/customs/snapshot.ts";
import { publishCustomSnapshot } from "#src/customs/socket.ts";
import { createSingleFlightRunner } from "#src/customs/single-flight.ts";
import { returnCustomResultPlayersToLobby } from "#src/customs/result-voice.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-reconciler");
const RECONCILE_INTERVAL_MS = 60_000;
const RESULT_POLL_DELAY_MS = 5 * 60_000;

async function reconcileAway(
  database: ExtendedPrismaClient,
  nightId: string,
  now: Date,
): Promise<void> {
  const snapshot = await getCustomNight(database, nightId);
  if (snapshot === null) return;
  const marked = markOverdueAway(snapshot, now);
  const changed = marked.participants.some(
    (participant, index) =>
      participant.awayOverdue !== snapshot.participants[index]?.awayOverdue,
  );
  if (!changed) return;
  const mutation = await commitCustomMutation({
    prisma: database,
    nightId,
    expectedRevision: snapshot.revision,
    actorDiscordId: "SCOUT",
    action: "AWAY_DEADLINES_RECONCILED",
    payload: {
      overdueDiscordIds: marked.participants
        .filter((participant) => participant.awayOverdue)
        .map((participant) => participant.discordId),
    },
    update: () => marked,
  });
  if (mutation.applied) publishCustomSnapshot(mutation.snapshot);
}

async function expireNight(
  database: ExtendedPrismaClient,
  nightId: string,
  now: Date,
): Promise<boolean> {
  const snapshot = await getCustomNight(database, nightId);
  if (
    snapshot === null ||
    hasActiveTournamentCodeProvisioning(snapshot.currentGame, now) ||
    hasActiveVoiceArrangementProvisioning(snapshot.currentGame, now) ||
    !shouldExpireCustomNight(snapshot, now)
  ) {
    return false;
  }
  const mutation = await commitCustomMutation({
    prisma: database,
    nightId,
    expectedRevision: snapshot.revision,
    actorDiscordId: "SCOUT",
    action: "NIGHT_EXPIRED",
    payload: {},
    update: (current) =>
      CustomNightSnapshotSchema.parse({
        ...current,
        state: transitionCustomNight(current.state, { type: "END_NIGHT" }),
        endedAt: now.toISOString(),
        expiresAt: now.toISOString(),
      }),
  });
  if (mutation.applied) {
    publishCustomSnapshot(mutation.snapshot);
    try {
      const cleanupFailures = await cleanupCustomVoice(mutation.snapshot);
      if (cleanupFailures.length > 0)
        logger.error("Expired custom night voice cleanup failed", {
          cleanupFailures,
          nightId,
        });
    } catch (error) {
      logger.error("Expired custom night voice cleanup failed", {
        error,
        nightId,
      });
    }
  }
  return mutation.applied;
}

async function markResultPending(
  database: ExtendedPrismaClient,
  nightId: string,
  now: Date,
): Promise<void> {
  const snapshot = await getCustomNight(database, nightId);
  if (snapshot === null) return;
  const game = snapshot.currentGame;
  if (
    game?.state !== "PLAYING" ||
    game.startedAt === null ||
    now.getTime() - new Date(game.startedAt).getTime() < RESULT_POLL_DELAY_MS
  ) {
    return;
  }
  const mutation = await commitCustomMutation({
    prisma: database,
    nightId,
    expectedRevision: snapshot.revision,
    actorDiscordId: "SCOUT",
    action: "RIOT_RESULT_POLLING_STARTED",
    payload: { tournamentCode: game.tournamentCode },
    update: (current) => {
      if (current.currentGame === null)
        throw new Error("Custom game disappeared during result polling");
      return CustomNightSnapshotSchema.parse({
        ...current,
        currentGame: {
          ...current.currentGame,
          state: transitionCustomGame(current.currentGame.state, {
            type: "AWAIT_RESULT",
          }),
        },
      });
    },
  });
  if (mutation.applied) publishCustomSnapshot(mutation.snapshot);
}

async function recoverTournamentCode(
  database: ExtendedPrismaClient,
  nightId: string,
): Promise<void> {
  const snapshot = await getCustomNight(database, nightId);
  if (snapshot?.currentGame?.state !== "CODE_PENDING") return;
  try {
    const mutation = await provisionCustomTournamentCode({
      prisma: database,
      nightId,
      actorDiscordId: "SCOUT",
    });
    if (mutation.applied) publishCustomSnapshot(mutation.snapshot);
  } catch (error) {
    const recovered = await getCustomNight(database, nightId);
    if (recovered !== null) publishCustomSnapshot(recovered);
    throw error;
  }
}

async function pollResult(
  database: ExtendedPrismaClient,
  nightId: string,
): Promise<void> {
  const games = await database.customGame.findMany({
    where: {
      nightId,
      state: { in: ["RESULT_PENDING", "MANUAL"] },
      tournamentCode: { not: null },
    },
    orderBy: { sequence: "asc" },
  });
  for (const game of games) {
    if (game.tournamentCode === null) continue;
    const results = await getTournamentGames(game.tournamentCode);
    const result = results.at(-1);
    if (result === undefined) continue;
    const mutation = await recordRiotTournamentResult({
      prisma: database,
      nightId,
      result,
    });
    if (!mutation.applied) continue;
    const voiceReturn =
      mutation.snapshot.currentGame?.id === game.id
        ? returnCustomResultPlayersToLobby({
            snapshot: mutation.snapshot,
            nightId,
            source: "riot",
          })
        : null;
    publishCustomSnapshot(mutation.snapshot);
    if (voiceReturn !== null) await voiceReturn;
    return;
  }
}

export async function retryPendingCustomImports(
  database: ExtendedPrismaClient,
  importGame: typeof importCustomMatchDetails = importCustomMatchDetails,
): Promise<void> {
  const games = await database.customGame.findMany({
    where: { state: "VERIFIED", importedAt: null },
    orderBy: [{ completedAt: "asc" }, { sequence: "asc" }],
    select: { id: true, nightId: true },
  });
  for (const game of games) {
    try {
      const mutation = await importGame({
        prisma: database,
        gameId: game.id,
      });
      if (mutation?.applied === true) publishCustomSnapshot(mutation.snapshot);
    } catch (error) {
      logger.error("Custom game import retry failed", {
        error,
        gameId: game.id,
        nightId: game.nightId,
      });
    }
  }
}

export async function reconcileCustomNights(
  database: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<void> {
  const pointers = await database.customActiveNight.findMany({
    select: { nightId: true },
  });
  for (const pointer of pointers) {
    try {
      if (await expireNight(database, pointer.nightId, now)) continue;
      await reconcileAway(database, pointer.nightId, now);
      await recoverTournamentCode(database, pointer.nightId);
      await markResultPending(database, pointer.nightId, now);
      await pollResult(database, pointer.nightId);
    } catch (error) {
      logger.error("Custom night reconciliation failed", {
        error,
        nightId: pointer.nightId,
      });
    }
  }
  await retryPendingCustomImports(database);
}

const runScheduledReconciliation = createSingleFlightRunner(async () => {
  try {
    await reconcileCustomNights();
  } catch (error) {
    logger.error("Custom night reconciliation cycle failed", { error });
  }
});

export function startCustomsReconciler(): void {
  if (configuration.customs === undefined) return;
  void runScheduledReconciliation();
  const timer = setInterval(
    () => void runScheduledReconciliation(),
    RECONCILE_INTERVAL_MS,
  );
  timer.unref();
}
