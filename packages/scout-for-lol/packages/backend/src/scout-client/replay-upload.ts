import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import type { AuthenticatedScoutClient } from "./authentication.ts";

export const MAX_REPLAY_BYTES = 512 * 1024 * 1024;
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const GameIdSchema = z.string().regex(/^\d{1,32}$/);
const UniqueViolationSchema = z.object({ code: z.literal("P2002") });
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
  | { readonly state: "claimed"; readonly artifactId: string }
  | { readonly state: "completed"; readonly replay: ReplayUploadResult };

type ReceivedReplay = {
  readonly bytes: number;
  readonly digest: string;
};

async function existingReplay(
  digest: string,
): Promise<ReplayUploadResult | null> {
  const existing = await prisma.scoutClientReplayArtifact.findUnique({
    where: { digest },
    select: { uploadState: true, digest: true, bytes: true },
  });
  if (existing?.uploadState === "COMPLETED") {
    return {
      outcome: "already_accepted",
      digest: existing.digest,
      bytes: Number(existing.bytes),
    };
  }
  if (existing?.uploadState === "UPLOADING") {
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
): Promise<void> {
  const observedMatch = await prisma.scoutClientObservation.findFirst({
    where: {
      deviceId: device.deviceId,
      gameId: metadata.gameId,
      kind: "post_game",
      disposition: "ACCEPTED",
    },
    select: { observationId: true },
  });
  if (observedMatch === null) {
    throw new ReplayUploadError(
      "Replay has no accepted post-game observation from this device",
      403,
    );
  }
}

async function claimReplayArtifact(
  metadata: ReplayMetadata,
  objectKey: string,
  device: AuthenticatedScoutClient,
): Promise<ReplayClaim> {
  try {
    const artifact = await prisma.scoutClientReplayArtifact.create({
      data: {
        deviceId: device.deviceId,
        gameId: metadata.gameId,
        digest: metadata.digest,
        objectKey,
        bytes: BigInt(metadata.declaredBytes),
        uploadState: "UPLOADING",
      },
      select: { id: true },
    });
    return { state: "claimed", artifactId: artifact.id };
  } catch (error) {
    if (!UniqueViolationSchema.safeParse(error).success) throw error;
  }

  const raced = await existingReplay(metadata.digest);
  if (raced !== null) return { state: "completed", replay: raced };
  const reclaimed = await prisma.scoutClientReplayArtifact.updateMany({
    where: { digest: metadata.digest, uploadState: "FAILED" },
    data: {
      deviceId: device.deviceId,
      gameId: metadata.gameId,
      bytes: BigInt(metadata.declaredBytes),
      uploadState: "UPLOADING",
      lastError: null,
    },
  });
  if (reclaimed.count !== 1) {
    throw new ReplayUploadError("Replay upload cannot be resumed yet", 409);
  }
  const resumed = await prisma.scoutClientReplayArtifact.findUnique({
    where: { digest: metadata.digest },
    select: { id: true },
  });
  if (resumed === null) {
    throw new ReplayUploadError("Replay upload claim disappeared", 409);
  }
  return { state: "claimed", artifactId: resumed.id };
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
  error: unknown,
): Promise<void> {
  await prisma.scoutClientReplayArtifact.update({
    where: { id: artifactId },
    data: {
      uploadState: "FAILED",
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
  await requireObservedMatch(metadata, device);
  const duplicate = await existingReplay(metadata.digest);
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
    await uploadReplayObject(metadata, objectKey, temporaryPath, received);
    await prisma.scoutClientReplayArtifact.update({
      where: { id: claim.artifactId },
      data: {
        uploadState: "COMPLETED",
        completedAt: new Date(),
        bytes: BigInt(received.bytes),
      },
    });
    return {
      outcome: "accepted",
      digest: received.digest,
      bytes: received.bytes,
    };
  } catch (error) {
    await markReplayFailed(claim.artifactId, error);
    throw error;
  } finally {
    await removeTemporaryReplay(temporaryPath);
  }
}
