import { createHash, timingSafeEqual } from "node:crypto";
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import {
  getTournamentGames,
  RawTournamentCallbackSchema,
  RiotTournamentApiError,
  TournamentMetadataSchema,
} from "#src/customs/riot-tournament.ts";
import { recordRiotTournamentResult } from "#src/customs/riot-results.ts";
import { returnCustomResultPlayersToLobby } from "#src/customs/result-voice.ts";
import { publishCustomSnapshotIfCurrent } from "#src/customs/socket.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-riot-callback");

function callbackSecretMatches(candidate: string): boolean {
  const expected = configuration.customs?.callbackSecret;
  if (expected === undefined) return false;
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export async function handleCustomRiotCallback(
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== "/api/customs/riot/callback") return null;
  if (request.method !== "POST")
    return new Response("Method Not Allowed", { status: 405 });

  let rawCallback: unknown;
  try {
    rawCallback = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid Tournament callback JSON" },
      { status: 400 },
    );
  }
  const callbackResult = RawTournamentCallbackSchema.safeParse(rawCallback);
  if (!callbackResult.success) {
    return Response.json(
      { error: "Invalid Tournament callback" },
      { status: 400 },
    );
  }
  const callback = callbackResult.data;
  let rawMetadata: unknown;
  try {
    rawMetadata = JSON.parse(callback.metaData);
  } catch {
    return Response.json(
      { error: "Invalid Tournament callback metadata JSON" },
      { status: 400 },
    );
  }
  const metadataResult = TournamentMetadataSchema.safeParse(rawMetadata);
  if (!metadataResult.success) {
    return Response.json(
      { error: "Invalid Tournament callback metadata" },
      { status: 400 },
    );
  }
  const metadata = metadataResult.data;
  if (!callbackSecretMatches(metadata.callbackSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const game = await prisma.customGame.findUnique({
      where: { tournamentCode: callback.shortCode },
    });
    if (game === null) {
      return new Response("Tournament game not found", { status: 404 });
    }
    if (game.nightId !== metadata.nightId || game.id !== metadata.gameId) {
      return new Response("Tournament game not found", { status: 404 });
    }
    const results = await getTournamentGames(callback.shortCode);
    const result = results.find(
      (candidate) => candidate.gameId === callback.gameId,
    );
    if (result === undefined)
      return new Response("Tournament result not ready", { status: 503 });
    const mutation = await recordRiotTournamentResult({
      prisma,
      nightId: metadata.nightId,
      result,
    });
    if (mutation.applied) {
      const shouldReturnVoicePlayers =
        mutation.snapshot.currentGame?.id === game.id;
      publishCustomSnapshotIfCurrent(prisma, mutation.snapshot);
      if (shouldReturnVoicePlayers) {
        void returnCustomResultPlayersToLobby({
          prisma,
          snapshot: mutation.snapshot,
          nightId: metadata.nightId,
          source: "riot",
        });
      }
    }
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof RiotTournamentApiError) {
      logger.error("Riot Tournament callback verification failed upstream", {
        error,
        shortCode: callback.shortCode,
      });
      return Response.json(
        { error: "Riot Tournament service is unavailable" },
        { status: 502 },
      );
    }
    logger.error("Riot Tournament callback processing failed", {
      error,
      shortCode: callback.shortCode,
    });
    return Response.json(
      { error: "Tournament callback processing failed" },
      { status: 500 },
    );
  }
}
