import { type FileHandle, open } from "node:fs/promises";
import {
  LeaguePuuidSchema,
  type LeaguePuuid,
} from "@scout-for-lol/domain/identity/league-account.ts";
import { z } from "zod";
import {
  getReplayContainerLayout,
  normalizeGameBuild,
  readReplayChunkHeader,
  ReplayTransportError,
  sameGameBuild as sharedSameGameBuild,
  type ReplayContainerLayout,
} from "@scout-for-lol/domain/artifacts/replay-transport.mjs";

export function sameGameBuild(left: string, right: string): boolean {
  return sharedSameGameBuild(left, right);
}

const FILE_HEADER_BYTES = 15;
const REPLAY_SIGNATURE_BYTES = 256;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = 4096;
export const MAX_DURATION_DRIFT_MS = 5000;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

const ReplayIntegerSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().nonnegative());
const ReplayMetadataSchema = z.looseObject({
  gameLength: z
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60 * 1000),
  lastGameChunkId: z.number().int().nonnegative().max(MAX_CHUNKS),
  lastKeyFrameId: z.number().int().nonnegative().max(MAX_CHUNKS),
  statsJson: z.string().min(2).max(MAX_METADATA_BYTES),
});
const ReplayParticipantSchema = z.looseObject({
  PUUID: LeaguePuuidSchema,
  TEAM: ReplayIntegerSchema,
  CHAMPIONS_KILLED: ReplayIntegerSchema,
  NUM_DEATHS: ReplayIntegerSchema,
  ASSISTS: ReplayIntegerSchema,
  GOLD_EARNED: ReplayIntegerSchema,
  GOLD_SPENT: ReplayIntegerSchema,
  TOTAL_DAMAGE_DEALT_TO_CHAMPIONS: ReplayIntegerSchema,
  MINIONS_KILLED: ReplayIntegerSchema,
  VISION_SCORE: ReplayIntegerSchema,
  WARD_PLACED: ReplayIntegerSchema,
  WARD_KILLED: ReplayIntegerSchema,
  LEVEL: ReplayIntegerSchema,
  WIN: z
    .enum(["Win", "Fail", "LeaverFail"])
    .transform((outcome) => (outcome === "LeaverFail" ? "Fail" : outcome)),
  ITEM0: ReplayIntegerSchema,
  ITEM1: ReplayIntegerSchema,
  ITEM2: ReplayIntegerSchema,
  ITEM3: ReplayIntegerSchema,
  ITEM4: ReplayIntegerSchema,
  ITEM5: ReplayIntegerSchema,
  ITEM6: ReplayIntegerSchema,
});
const ReplayParticipantsSchema = z
  .array(ReplayParticipantSchema)
  .min(1)
  .max(20);

export type ReplayParticipantFingerprint = {
  readonly puuid: LeaguePuuid;
  readonly teamId: number;
  readonly kills: number;
  readonly deaths: number;
  readonly assists: number;
  readonly goldEarned: number;
  readonly goldSpent: number;
  readonly totalDamageDealtToChampions: number;
  readonly totalMinionsKilled: number;
  readonly visionScore: number;
  readonly wardsPlaced: number;
  readonly wardsKilled: number;
  readonly championLevel: number;
  readonly win: "Win" | "Fail";
  readonly items: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
};

export class ReplayContainerError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 503,
  ) {
    super(message);
  }
}

export type ReplayProvenance = {
  readonly localPuuid: string;
  readonly leaguePatch: string | null;
  readonly gameDurationSeconds: number;
  readonly participant: ReplayParticipantFingerprint;
};

function replayParticipantFingerprint(
  participant: z.infer<typeof ReplayParticipantSchema>,
): ReplayParticipantFingerprint {
  return {
    puuid: participant.PUUID,
    teamId: participant.TEAM,
    kills: participant.CHAMPIONS_KILLED,
    deaths: participant.NUM_DEATHS,
    assists: participant.ASSISTS,
    goldEarned: participant.GOLD_EARNED,
    goldSpent: participant.GOLD_SPENT,
    totalDamageDealtToChampions: participant.TOTAL_DAMAGE_DEALT_TO_CHAMPIONS,
    totalMinionsKilled: participant.MINIONS_KILLED,
    visionScore: participant.VISION_SCORE,
    wardsPlaced: participant.WARD_PLACED,
    wardsKilled: participant.WARD_KILLED,
    championLevel: participant.LEVEL,
    win: participant.WIN,
    items: [
      participant.ITEM0,
      participant.ITEM1,
      participant.ITEM2,
      participant.ITEM3,
      participant.ITEM4,
      participant.ITEM5,
      participant.ITEM6,
    ],
  };
}

async function readExactly(
  file: FileHandle,
  length: number,
  position: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const result = await file.read(buffer, 0, length, position);
  if (result.bytesRead !== length) {
    throw new ReplayContainerError("Replay container is truncated", 400);
  }
  return buffer;
}

function parseJson(input: string, message: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    throw new ReplayContainerError(message, 400);
  }
}

async function validateChunks(
  file: FileHandle,
  layout: ReplayContainerLayout,
  {
    start,
    end,
    expectedCount,
  }: { start: number; end: number; expectedCount: number },
): Promise<void> {
  let cursor = start;
  let chunkCount = 0;
  while (cursor < end) {
    if (chunkCount >= MAX_CHUNKS || cursor + layout.chunkHeaderBytes > end) {
      throw new ReplayContainerError("Replay chunk table is invalid", 400);
    }
    const header = await readExactly(file, layout.chunkHeaderBytes, cursor);
    const { compressedSize, storedSize } = readReplayChunkHeader(
      header,
      layout,
    );
    if (cursor + layout.chunkHeaderBytes + storedSize > end) {
      throw new ReplayContainerError("Replay chunk table is invalid", 400);
    }
    if (compressedSize > 0) {
      if (compressedSize < ZSTD_MAGIC.byteLength) {
        throw new ReplayContainerError(
          "Replay chunk is too short for a Zstandard frame",
          400,
        );
      }
      const magic = await readExactly(
        file,
        ZSTD_MAGIC.byteLength,
        cursor + layout.chunkHeaderBytes,
      );
      if (!magic.equals(ZSTD_MAGIC)) {
        throw new ReplayContainerError(
          "Replay chunk is missing its Zstandard frame marker",
          400,
        );
      }
    }
    cursor += layout.chunkHeaderBytes + storedSize;
    chunkCount += 1;
  }
  if (cursor !== end || chunkCount !== expectedCount) {
    throw new ReplayContainerError("Replay chunk count is invalid", 400);
  }
}

/**
 * Find the uploader among the replay's participants and require their stats to
 * match the evidence exactly. The replay names them by League-client UUID, so
 * the participant is compared under the provenance PUUID.
 */
function requireObservedParticipant(
  participants: readonly z.infer<typeof ReplayParticipantSchema>[],
  provenance: ReplayProvenance,
  observerIds: ReadonlySet<string>,
): void {
  const observer = participants.find((participant) =>
    observerIds.has(participant.PUUID),
  );
  if (observer === undefined) {
    throw new ReplayContainerError(
      "Replay does not contain the device player's observed identity",
      403,
    );
  }
  if (
    JSON.stringify({
      ...replayParticipantFingerprint(observer),
      puuid: provenance.localPuuid,
    }) !== JSON.stringify(provenance.participant)
  ) {
    throw new ReplayContainerError(
      "Replay participant does not match the observed match",
      403,
    );
  }
}

async function validateReplayHeader(
  file: FileHandle,
  leaguePatch: string | null,
): Promise<{
  gameBuild: string;
  protocol: string;
  headerEnd: number;
  layout: ReplayContainerLayout;
}> {
  const header = await readExactly(file, FILE_HEADER_BYTES, 0);
  const versionLength = header[14];
  if (
    versionLength === undefined ||
    versionLength === 0 ||
    versionLength > 64 ||
    header.subarray(0, 4).toString("ascii") !== "RIOT" ||
    header.readUInt16LE(4) !== 2
  )
    throw new ReplayContainerError("Replay header is invalid", 400);
  const versionBytes = await readExactly(
    file,
    versionLength,
    FILE_HEADER_BYTES,
  );
  const gameBuild = normalizeGameBuild(
    versionBytes.toString("utf8").replace(/\0+$/, ""),
  );
  if (gameBuild === null)
    throw new ReplayContainerError("Replay version is invalid", 400);
  if (leaguePatch !== null && !sameGameBuild(gameBuild, leaguePatch))
    throw new ReplayContainerError(
      "Replay patch does not match the observed match",
      403,
    );
  const protocol = header.subarray(6, 14).toString("hex");
  return {
    gameBuild,
    protocol,
    headerEnd: FILE_HEADER_BYTES + versionLength,
    layout: getReplayContainerLayout(gameBuild, protocol),
  };
}

/**
 * Validate the ROFL container and bind its embedded player identity to evidence.
 *
 * A replay names players by League-client UUID while provenance is in Riot
 * PUUIDs, so `observerIds` is every identity that denotes the uploader: their
 * PUUID and any UUID aliased to it. The matched participant is then compared
 * under the PUUID, so the fingerprint check stays exactly as strict.
 */
export async function validateReplayContainer(
  path: string,
  bytes: number,
  provenance: ReplayProvenance,
  observerIds: ReadonlySet<string> = new Set([provenance.localPuuid]),
): Promise<{ gameBuild: string; protocol: string; durationSeconds: number }> {
  const file = await open(path, "r");
  try {
    if (bytes < FILE_HEADER_BYTES + REPLAY_SIGNATURE_BYTES + 4) {
      throw new ReplayContainerError("Replay container is too short", 400);
    }
    const { gameBuild, protocol, headerEnd, layout } =
      await validateReplayHeader(file, provenance.leaguePatch);

    const metadataLengthBytes = await readExactly(file, 4, bytes - 4);
    const metadataLength = metadataLengthBytes.readUInt32LE(0);
    const metadataStart = bytes - 4 - metadataLength;
    const signatureStart = metadataStart - REPLAY_SIGNATURE_BYTES;
    if (
      metadataLength === 0 ||
      metadataLength > MAX_METADATA_BYTES ||
      signatureStart <= headerEnd
    ) {
      throw new ReplayContainerError(
        "Replay metadata boundary is invalid",
        400,
      );
    }
    const metadataBytes = await readExactly(
      file,
      metadataLength,
      metadataStart,
    );
    const metadata = ReplayMetadataSchema.safeParse(
      parseJson(metadataBytes.toString("utf8"), "Replay metadata is invalid"),
    );
    if (!metadata.success) {
      throw new ReplayContainerError("Replay metadata is invalid", 400);
    }
    if (
      Math.abs(
        metadata.data.gameLength - provenance.gameDurationSeconds * 1000,
      ) > MAX_DURATION_DRIFT_MS
    ) {
      throw new ReplayContainerError(
        "Replay duration does not match the observed match",
        403,
      );
    }
    const participants = ReplayParticipantsSchema.safeParse(
      parseJson(
        metadata.data.statsJson,
        "Replay participant metadata is invalid",
      ),
    );
    if (!participants.success) {
      throw new ReplayContainerError(
        "Replay participant metadata is invalid",
        400,
      );
    }
    requireObservedParticipant(participants.data, provenance, observerIds);

    const expectedChunks =
      metadata.data.lastGameChunkId + metadata.data.lastKeyFrameId;
    if (expectedChunks <= 0 || expectedChunks > MAX_CHUNKS) {
      throw new ReplayContainerError("Replay chunk count is invalid", 400);
    }
    await validateChunks(file, layout, {
      start: headerEnd,
      end: signatureStart,
      expectedCount: expectedChunks,
    });
    return {
      gameBuild,
      protocol,
      durationSeconds: metadata.data.gameLength / 1000,
    };
  } catch (error) {
    if (error instanceof ReplayTransportError) {
      throw new ReplayContainerError(
        error.message,
        error.code === "unsupported-container" ? 503 : 400,
      );
    }
    throw error;
  } finally {
    await file.close();
  }
}
