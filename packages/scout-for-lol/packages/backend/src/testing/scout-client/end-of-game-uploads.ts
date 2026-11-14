import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { aliasedLcuBundle } from "#src/testing/report-lake/lcu-bundle-fixtures.ts";
import {
  classicEndOfGameBlock,
  classicGameflow,
  type EndOfGameBlockFixture,
} from "#src/testing/scout-client/end-of-game-fixtures.ts";

/**
 * The Classic game's uploads stored the way ingress stores them, already
 * translated, for integration tests that read observations back: a device's
 * gameflow session then its end-of-game block alone, or its history bundle.
 */

/** The measured default (`DEFAULT_SCOUT_CLIENT_END_OF_GAME_DEADLINE_SECONDS`). */
export const END_OF_GAME_DEADLINE_MS = 360_000;

export function observerOf(block: EndOfGameBlockFixture): string {
  const observer = block.teams[0]?.players[0]?.puuid;
  if (observer === undefined) throw new Error("The fixture has players");
  return observer;
}

/** The same block, as a ranked game Riot would publish. */
export function asRanked(block: EndOfGameBlockFixture): void {
  block.queueType = "RANKED_SOLO_5x5";
  block.gameMode = "CLASSIC";
}

/** The ranked gameflow `asRanked` blocks convert with. */
export function rankedGameflow(block: EndOfGameBlockFixture) {
  return classicGameflow(block, {
    queue: {
      id: 420,
      type: block.queueType,
      gameMode: block.gameMode,
      mapId: 11,
    },
  });
}

const StoredPayloadSchema = z.object({ resource: z.string(), data: z.json() });

export function endOfGameUploads(
  prisma: ExtendedPrismaClient,
  matchId: RiotMatchId,
) {
  const gameId = matchId.slice(matchId.indexOf("_") + 1);
  const sequences = new Map<string, number>();

  /** Store one accepted observation the way ingress does, already translated. */
  async function store(input: {
    deviceId: string;
    kind: "gameflow" | "post_game";
    observer: string;
    payload: unknown;
    receivedAt: Date;
  }): Promise<string> {
    const sequence = (sequences.get(input.deviceId) ?? 0) + 1;
    sequences.set(input.deviceId, sequence);
    const observationId = crypto.randomUUID();
    await prisma.scoutClientObservation.create({
      data: {
        observationId,
        deviceId: input.deviceId,
        sequence: BigInt(sequence),
        capturedAt: input.receivedAt,
        receivedAt: input.receivedAt,
        protocolVersion: 1,
        schemaVersion: 1,
        appVersion: "0.1.0",
        kind: input.kind,
        localPuuid: input.observer,
        platformId: "NA1",
        gameId,
        payload: StoredPayloadSchema.parse(input.payload),
        bodyDigest: `digest-${observationId}`,
        disposition: "ACCEPTED",
      },
    });
    return observationId;
  }

  /**
   * A device's gameflow session, then its end-of-game block alone. `edit`
   * changes the block; `gameflow` replaces the session it converts with.
   */
  async function uploadEndOfGame(
    deviceId: string,
    receivedAt: Date,
    edit?: (block: EndOfGameBlockFixture) => void,
    gameflow: (block: EndOfGameBlockFixture) => unknown = classicGameflow,
  ): Promise<string> {
    const block = await classicEndOfGameBlock();
    edit?.(block);
    const observer = observerOf(block);
    await store({
      deviceId,
      kind: "gameflow",
      observer,
      payload: gameflow(block),
      receivedAt,
    });
    return await store({
      deviceId,
      kind: "post_game",
      observer,
      payload: { resource: "post_game", data: block },
      receivedAt,
    });
  }

  /** The game's history bundle; `endedAt` moves its timing, keeping its length. */
  async function uploadBundle(
    deviceId: string,
    receivedAt: Date,
    endedAt?: number,
  ): Promise<string> {
    const block = await classicEndOfGameBlock();
    const bundle = await aliasedLcuBundle("lcu-postgame-classic");
    const durationMs =
      bundle.timing.gameEndTimestamp - bundle.timing.gameStartTimestamp;
    return await store({
      deviceId,
      kind: "post_game",
      observer: observerOf(block),
      payload: {
        resource: "post_game",
        data:
          endedAt === undefined
            ? bundle
            : {
                ...bundle,
                timing: {
                  gameStartTimestamp: endedAt - durationMs,
                  gameEndTimestamp: endedAt,
                },
              },
      },
      receivedAt,
    });
  }

  return {
    store,
    uploadEndOfGame,
    uploadBundle,
    reset: () => {
      sequences.clear();
    },
  };
}
