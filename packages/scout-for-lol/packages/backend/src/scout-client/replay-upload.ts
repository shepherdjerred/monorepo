import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import { prisma, type Db } from "#src/database/index.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import type { AuthenticatedScoutClient } from "./authentication.ts";
import {
  ReplayContainerError,
  validateReplayContainer,
  type ReplayProvenance,
} from "./replay/container.ts";
import { parseObservedReplayProvenance } from "./replay/provenance.ts";
import {
  replayUploadClaimIsStale,
  replayUploadLeaseCutoff,
} from "./replay-lease.ts";

export const MAX_REPLAY_BYTES = 512 * 1024 * 1024;
export const MAX_OWNER_REPLAY_BYTES_PER_DAY = 2n * 1024n * 1024n * 1024n;
export const MAX_OWNER_REPLAYS_PER_DAY = 20;
const REPLAY_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const GameIdSchema = z.string().regex(/^\d{1,32}$/);
const FileNotFoundSchema = z.object({ code: z.literal("ENOENT") });
const BodyChunkSchema = z.instanceof(Uint8Array);
const s3 = createS3Client();

export class ReplayUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type ReplayUploadResult = {
  readonly outcome: "accepted" | "already_accepted";
  readonly digest: string;
  readonly bytes: number;
};

type ReplayMetadata = {
  readonly gameId: string;
  readonly digest: string;
  readonly declaredBytes: number;
  readonly body: ReadableStream<Uint8Array>;
};

type ReplayClaim =
  | {
      readonly state: "claimed";
      readonly artifactId: string;
      readonly leasedAt: Date;
    }
  | { readonly state: "completed"; readonly replay: ReplayUploadResult };

type ReceivedReplay = {
  readonly bytes: number;
  readonly digest: string;
};

type ReplayArtifactDatabase = Pick<Db, "scoutClientReplayArtifact">;
type ReplayClaimDatabase = Pick<
  Db,
  "$executeRaw" | "scoutClientReplayArtifact"
>;

function completedReplay(
  existing: {
    readonly gameId: string;
    readonly digest: string;
    readonly bytes: bigint;
  },
  requestedGameId: string,
): ReplayUploadResult {
  if (existing.gameId !== requestedGameId) {
    throw new ReplayUploadError(
      "Replay digest already belongs to another game",
      400,
    );
  }
  return {
    outcome: "already_accepted",
    digest: existing.digest,
    bytes: Number(existing.bytes),
  };
}

async function existingReplay(
  metadata: Pick<ReplayMetadata, "digest" | "gameId">,
  database: ReplayArtifactDatabase = prisma,
  now = new Date(),
): Promise<ReplayUploadResult | null> {
  const existing = await database.scoutClientReplayArtifact.findUnique({
    where: { digest: metadata.digest },
    select: {
      uploadState: true,
      gameId: true,
      digest: true,
      bytes: true,
      updatedAt: true,
    },
  });
  if (existing?.uploadState === "COMPLETED") {
    return completedReplay(existing, metadata.gameId);
  }
  if (
    existing?.uploadState === "UPLOADING" &&
    !replayUploadClaimIsStale(existing.updatedAt, now)
  ) {
    throw new ReplayUploadError("Replay upload is already in progress", 409);
  }
  return null;
}

function parseReplayMetadata(
  request: Request,
  gameIdInput: string,
): ReplayMetadata {
  const gameId = GameIdSchema.safeParse(gameIdInput);
  const digest = DigestSchema.safeParse(request.headers.get("X-Scout-SHA256"));
  const declaredBytes = z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_REPLAY_BYTES)
    .safeParse(request.headers.get("Content-Length"));
  if (!gameId.success || !digest.success || !declaredBytes.success) {
    throw new ReplayUploadError("Replay metadata is invalid", 400);
  }
  if (request.headers.get("Content-Type") !== "application/vnd.riot.rofl") {
    throw new ReplayUploadError("Replay content type is invalid", 415);
  }
  if (request.body === null) {
    throw new ReplayUploadError("Replay body is required", 400);
  }
  return {
    gameId: gameId.data,
    digest: digest.data,
    declaredBytes: declaredBytes.data,
    body: request.body,
  };
}

async function requireObservedMatch(
  metadata: ReplayMetadata,
  device: AuthenticatedScoutClient,
): Promise<ReplayProvenance> {
  const observedMatches = await prisma.scoutClientObservation.findMany({
    where: {
      deviceId: device.deviceId,
      gameId: metadata.gameId,
      kind: "post_game",
      disposition: "ACCEPTED",
    },
    select: { localPuuid: true, leaguePatch: true, payload: true },
  });
  for (const observedMatch of observedMatches) {
    if (observedMatch.localPuuid === null) continue;
    const provenance = parseObservedReplayProvenance({
      payload: observedMatch.payload,
      localPuuid: observedMatch.localPuuid,
      leaguePatch: observedMatch.leaguePatch,
      requestedGameId: metadata.gameId,
    });
    if (provenance !== null) return provenance;
  }
  throw new ReplayUploadError(
    "Replay is waiting for accepted match-history evidence from this device",
    409,
  );
}

async function requireReplayQuota(
  metadata: ReplayMetadata,
  device: AuthenticatedScoutClient,
  database: ReplayClaimDatabase,
): Promise<void> {
  const windowStart = new Date(Date.now() - REPLAY_QUOTA_WINDOW_MS);
  const usage = await database.scoutClientReplayArtifact.aggregate({
    where: {
      device: { ownerId: device.ownerId },
      createdAt: { gte: windowStart },
      digest: { not: metadata.digest },
    },
    _count: { _all: true },
    _sum: { bytes: true },
  });
  const reservedBytes = usage._sum.bytes ?? 0n;
  if (
    usage._count._all >= MAX_OWNER_REPLAYS_PER_DAY ||
    reservedBytes + BigInt(metadata.declaredBytes) >
      MAX_OWNER_REPLAY_BYTES_PER_DAY
  ) {
    throw new ReplayUploadError("Owner replay upload quota exceeded", 429);
  }
}

async function claimReplayArtifact(
  metadata: ReplayMetadata,
  objectKey: string,
  device: AuthenticatedScoutClient,
): Promise<ReplayClaim> {
  const leasedAt = new Date();
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${metadata.digest}, 0))`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scout-client-replay-owner:${device.ownerId}`}, 0))`;
    const existing = await transaction.scoutClientReplayArtifact.findUnique({
      where: { digest: metadata.digest },
      select: {
        id: true,
        uploadState: true,
        gameId: true,
        digest: true,
        bytes: true,
        lastError: true,
        updatedAt: true,
      },
    });
    if (existing !== null && existing.gameId !== metadata.gameId) {
      throw new ReplayUploadError(
        "Replay digest belongs to a different game",
        400,
      );
    }
    if (existing?.uploadState === "COMPLETED") {
      return {
        state: "completed",
        replay: completedReplay(existing, metadata.gameId),
      };
    }
    if (
      existing?.uploadState === "UPLOADING" &&
      !replayUploadClaimIsStale(existing.updatedAt, leasedAt)
    ) {
      throw new ReplayUploadError("Replay upload is already in progress", 409);
    }
    if (existing?.uploadState === "REJECTED") {
      throw new ReplayUploadError(
        existing.lastError ?? "Replay was rejected",
        400,
      );
    }
    await requireReplayQuota(metadata, device, transaction);
    if (existing === null) {
      const artifact = await transaction.scoutClientReplayArtifact.create({
        data: {
          deviceId: device.deviceId,
          gameId: metadata.gameId,
          digest: metadata.digest,
          objectKey,
          bytes: BigInt(metadata.declaredBytes),
          uploadState: "UPLOADING",
          updatedAt: leasedAt,
        },
        select: { id: true },
      });
      return { state: "claimed", artifactId: artifact.id, leasedAt };
    }
    const reclaimed = await transaction.scoutClientReplayArtifact.updateMany({
      where: {
        digest: metadata.digest,
        gameId: metadata.gameId,
        OR: [
          { uploadState: "FAILED" },
          {
            uploadState: "UPLOADING",
            updatedAt: { lte: replayUploadLeaseCutoff(leasedAt) },
          },
        ],
      },
      data: {
        deviceId: device.deviceId,
        bytes: BigInt(metadata.declaredBytes),
        uploadState: "UPLOADING",
        lastError: null,
        updatedAt: leasedAt,
      },
    });
    if (reclaimed.count !== 1) {
      throw new ReplayUploadError("Replay upload cannot be resumed yet", 409);
    }
    return { state: "claimed", artifactId: existing.id, leasedAt };
  });
}

function appendReplayHeader(header: Uint8Array, chunk: Uint8Array): Uint8Array {
  if (header.byteLength >= 4) return header;
  const combined = new Uint8Array(header.byteLength + chunk.byteLength);
  combined.set(header);
  combined.set(chunk, header.byteLength);
  return combined.slice(0, 4);
}

async function receiveReplay(
  metadata: ReplayMetadata,
  temporaryPath: string,
): Promise<ReceivedReplay> {
  const fileHandle = await open(temporaryPath, "wx", 0o600);
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = metadata.body.getReader();
  let receivedBytes = 0;
  let header: Uint8Array = new Uint8Array();
  try {
    let result = await reader.read();
    while (!result.done) {
      const chunk = BodyChunkSchema.safeParse(result.value);
      if (!chunk.success) {
        throw new ReplayUploadError("Replay body is invalid", 400);
      }
      receivedBytes += chunk.data.byteLength;
      if (
        receivedBytes > metadata.declaredBytes ||
        receivedBytes > MAX_REPLAY_BYTES
      ) {
        await reader.cancel();
        throw new ReplayUploadError("Replay exceeds its declared size", 413);
      }
      header = appendReplayHeader(header, chunk.data);
      hasher.update(chunk.data);
      await fileHandle.write(chunk.data);
      result = await reader.read();
    }
    await fileHandle.sync();
  } finally {
    await fileHandle.close();
  }

  if (receivedBytes !== metadata.declaredBytes) {
    throw new ReplayUploadError(
      "Replay length does not match Content-Length",
      400,
    );
  }
  if (new TextDecoder().decode(header) !== "RIOT") {
    throw new ReplayUploadError("Replay does not have a ROFL header", 400);
  }
  const digest = hasher.digest("hex");
  if (digest !== metadata.digest) {
    throw new ReplayUploadError("Replay SHA-256 does not match", 400);
  }
  return { bytes: receivedBytes, digest };
}

async function uploadReplayObject(
  metadata: ReplayMetadata,
  objectKey: string,
  temporaryPath: string,
  received: ReceivedReplay,
): Promise<void> {
  if (configuration.s3BucketName === undefined) {
    throw new ReplayUploadError("Replay storage is unavailable", 503);
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: configuration.s3BucketName,
      Key: objectKey,
      Body: Bun.file(temporaryPath),
      ContentLength: received.bytes,
      ContentType: "application/vnd.riot.rofl",
      Metadata: {
        sha256: received.digest,
        gameid: metadata.gameId,
        source: "scout-client",
      },
    }),
  );
}

async function markReplayFailed(
  artifactId: string,
  leasedAt: Date,
  error: unknown,
): Promise<void> {
  const terminalRejection =
    error instanceof ReplayUploadError &&
    [400, 403, 413, 415].includes(error.status);
  await prisma.scoutClientReplayArtifact.updateMany({
    where: { id: artifactId, uploadState: "UPLOADING", updatedAt: leasedAt },
    data: {
      uploadState: terminalRejection ? "REJECTED" : "FAILED",
      lastError:
        error instanceof ReplayUploadError
          ? error.message
          : "SeaweedFS upload failed",
    },
  });
}

async function removeTemporaryReplay(temporaryPath: string): Promise<void> {
  try {
    await unlink(temporaryPath);
  } catch (error) {
    if (!FileNotFoundSchema.safeParse(error).success) throw error;
  }
}

export async function uploadReplay(
  request: Request,
  gameIdInput: string,
  device: AuthenticatedScoutClient,
): Promise<ReplayUploadResult> {
  const metadata = parseReplayMetadata(request, gameIdInput);
  const provenance = await requireObservedMatch(metadata, device);
  const duplicate = await existingReplay(metadata);
  if (duplicate !== null) return duplicate;

  const objectKey = `replays/${metadata.gameId}/${metadata.digest}.rofl`;
  const claim = await claimReplayArtifact(metadata, objectKey, device);
  if (claim.state === "completed") return claim.replay;

  const temporaryPath = nodePath.join(
    tmpdir(),
    `scout-replay-${claim.artifactId}.rofl`,
  );
  try {
    const received = await receiveReplay(metadata, temporaryPath);
    await validateReplayContainer(temporaryPath, received.bytes, provenance);
    await uploadReplayObject(metadata, objectKey, temporaryPath, received);
    const completed = await prisma.scoutClientReplayArtifact.updateMany({
      where: {
        id: claim.artifactId,
        uploadState: "UPLOADING",
        updatedAt: claim.leasedAt,
      },
      data: {
        uploadState: "COMPLETED",
        completedAt: new Date(),
        bytes: BigInt(received.bytes),
      },
    });
    if (completed.count !== 1) {
      throw new ReplayUploadError("Replay upload claim expired", 409);
    }
    return {
      outcome: "accepted",
      digest: received.digest,
      bytes: received.bytes,
    };
  } catch (error) {
    const uploadError =
      error instanceof ReplayContainerError
        ? new ReplayUploadError(error.message, error.status)
        : error;
    await markReplayFailed(claim.artifactId, claim.leasedAt, uploadError);
    throw uploadError;
  } finally {
    await removeTemporaryReplay(temporaryPath);
  }
}
