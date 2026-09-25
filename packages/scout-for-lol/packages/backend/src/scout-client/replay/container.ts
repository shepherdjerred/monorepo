import { type FileHandle, open } from "node:fs/promises";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { z } from "zod";

const FILE_HEADER_BYTES = 15;
const CHUNK_HEADER_BYTES = 17;
const REPLAY_SIGNATURE_BYTES = 256;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = 4096;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const MAX_DURATION_DRIFT_MS = 5000;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const VersionSchema = z.string().regex(/^\d{1,2}\.\d{1,2}\.\d{1,8}\.\d{1,8}$/);
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
  WIN: z.enum(["Win", "Fail"]),
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
  readonly puuid: string;
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
    readonly status: 400 | 403,
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
  start: number,
  end: number,
  expectedCount: number,
): Promise<void> {
  let cursor = start;
  let chunkCount = 0;
  while (cursor < end) {
    if (chunkCount >= MAX_CHUNKS || cursor + CHUNK_HEADER_BYTES > end) {
      throw new ReplayContainerError("Replay chunk table is invalid", 400);
    }
    const header = await readExactly(file, CHUNK_HEADER_BYTES, cursor);
    const uncompressedBytes = header.readUInt32LE(9);
    const compressedBytes = header.readUInt32LE(13);
    const bodyBytes =
      compressedBytes === 0 ? uncompressedBytes : compressedBytes;
    const streamTag = header.readUInt32LE(5);
    if (
      bodyBytes === 0 ||
      bodyBytes > MAX_CHUNK_BYTES ||
      (streamTag & 0x00_ff_ff_ff) !== 0 ||
      streamTag >>> 24 < 1 ||
      streamTag >>> 24 > 4 ||
      cursor + CHUNK_HEADER_BYTES + bodyBytes > end
    ) {
      throw new ReplayContainerError("Replay chunk table is invalid", 400);
    }
    if (compressedBytes > 0) {
      const magic = await readExactly(
        file,
        ZSTD_MAGIC.byteLength,
        cursor + CHUNK_HEADER_BYTES,
      );
      if (!magic.equals(ZSTD_MAGIC)) {
        throw new ReplayContainerError(
          "Replay chunk compression is invalid",
          400,
        );
      }
    }
    cursor += CHUNK_HEADER_BYTES + bodyBytes;
    chunkCount += 1;
  }
  if (cursor !== end || chunkCount !== expectedCount) {
    throw new ReplayContainerError("Replay chunk count is invalid", 400);
  }
}

/** Validate the ROFL container and bind its embedded player identity to evidence. */
export async function validateReplayContainer(
  path: string,
  bytes: number,
  provenance: ReplayProvenance,
): Promise<void> {
  const file = await open(path, "r");
  try {
    if (bytes < FILE_HEADER_BYTES + REPLAY_SIGNATURE_BYTES + 4) {
      throw new ReplayContainerError("Replay container is too short", 400);
    }
    const header = await readExactly(file, FILE_HEADER_BYTES, 0);
    const versionLength = header[14];
    if (
      versionLength === undefined ||
      versionLength === 0 ||
      versionLength > 64 ||
      header.subarray(0, 4).toString("ascii") !== "RIOT" ||
      header.readUInt16LE(4) !== 2
    ) {
      throw new ReplayContainerError("Replay header is invalid", 400);
    }
    const versionBytes = await readExactly(
      file,
      versionLength,
      FILE_HEADER_BYTES,
    );
    const version = VersionSchema.safeParse(versionBytes.toString("ascii"));
    if (!version.success) {
      throw new ReplayContainerError("Replay version is invalid", 400);
    }
    if (
      provenance.leaguePatch !== null &&
      version.data !== provenance.leaguePatch
    ) {
      throw new ReplayContainerError(
        "Replay patch does not match the observed match",
        403,
      );
    }

    const metadataLengthBytes = await readExactly(file, 4, bytes - 4);
    const metadataLength = metadataLengthBytes.readUInt32LE(0);
    const headerEnd = FILE_HEADER_BYTES + versionLength;
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
    const observer = participants.data.find(
      (participant) => participant.PUUID === provenance.localPuuid,
    );
    if (observer === undefined) {
      throw new ReplayContainerError(
        "Replay does not contain the device player's observed identity",
        403,
      );
    }
    if (
      JSON.stringify(replayParticipantFingerprint(observer)) !==
      JSON.stringify(provenance.participant)
    ) {
      throw new ReplayContainerError(
        "Replay participant does not match the observed match",
        403,
      );
    }

    const expectedChunks =
      metadata.data.lastGameChunkId + metadata.data.lastKeyFrameId;
    if (expectedChunks <= 0 || expectedChunks > MAX_CHUNKS) {
      throw new ReplayContainerError("Replay chunk count is invalid", 400);
    }
    await validateChunks(file, headerEnd, signatureStart, expectedChunks);
  } finally {
    await file.close();
  }
}
