import { Prisma } from "#generated/prisma/client.ts";
import {
  CreateUploadRequestSchema,
  EMPTY_BOARD_INDEX,
  type CommitUploadResponse,
  type CreateUploadRequest,
  type CreateUploadResponse,
} from "#shared/contract.ts";
import { inferKind, requestDigest } from "#domain/artifact-kind.ts";
import { mintContentToken } from "#domain/paths.ts";
import { transact, type Tx } from "#infrastructure/database.ts";
import { applyOpsLocked, lockBoardById } from "./boards.ts";
import { ArtifactsError } from "./errors.ts";
import { recordEvents } from "./events.ts";
import type { Audit, Caller, Deps } from "./types.ts";

const HOUR_MS = 3_600_000;
const DEFAULT_FRAME = { w: 1200, h: 800 };

type SessionRow = Prisma.UploadSessionGetPayload<{ include: { files: true } }>;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function assertWritable(deps: Deps) {
  if (!(await deps.settings.value("artifactsEnabled")))
    throw new ArtifactsError("FORBIDDEN", "Artifacts is paused");
}

async function assertLimits(deps: Deps, request: CreateUploadRequest) {
  const [maxFiles, maxFileBytes, maxVersionBytes] = await Promise.all([
    deps.settings.value("maxFiles"),
    deps.settings.value("maxFileBytes"),
    deps.settings.value("maxVersionBytes"),
  ]);
  if (request.files.length > maxFiles)
    throw new ArtifactsError(
      "PAYLOAD_TOO_LARGE",
      `At most ${String(maxFiles)} files per version`,
    );
  let total = 0;
  for (const file of request.files) {
    if (file.size > maxFileBytes)
      throw new ArtifactsError(
        "PAYLOAD_TOO_LARGE",
        `${file.path} exceeds the ${String(maxFileBytes)} byte file limit`,
      );
    total += file.size;
  }
  if (total > maxVersionBytes)
    throw new ArtifactsError(
      "PAYLOAD_TOO_LARGE",
      `The version exceeds the ${String(maxVersionBytes)} byte limit`,
    );
}

async function missingDigests(tx: Pick<Tx, "blob">, digests: string[]) {
  const present = await tx.blob.findMany({
    where: { sha256: { in: digests } },
    select: { sha256: true },
  });
  const have = new Set(present.map((blob) => blob.sha256));
  return [...new Set(digests)].filter((digest) => !have.has(digest));
}

export function createUploads(deps: Deps) {
  const { db } = deps;

  async function ensureBoard(slug: string, actor: Caller, requestId: string) {
    const existing = await db.board.findUnique({ where: { slug } });
    if (existing !== null) return existing;
    try {
      return await transact(db, async (tx) => {
        const board = await tx.board.create({
          data: { slug, title: slug, index: EMPTY_BOARD_INDEX },
        });
        await recordEvents(tx, [
          {
            boardId: board.id,
            kind: "board.created",
            entityId: board.id,
            actorId: actor.id,
            requestId,
          },
        ]);
        return board;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return db.board.findUniqueOrThrow({ where: { slug } });
    }
  }

  async function checkArtifact(request: CreateUploadRequest, boardId: string) {
    if (request.artifactId === undefined) {
      if (request.expectedCurrentVersionId !== null)
        throw new ArtifactsError(
          "BAD_REQUEST",
          "expectedCurrentVersionId must be null for a new artifact",
        );
      return null;
    }
    const artifact = await db.artifact.findFirst({
      where: { id: request.artifactId, boardId, deletedAt: null },
    });
    if (artifact === null)
      throw new ArtifactsError("NOT_FOUND", "Artifact not found on that board");
    if (artifact.currentVersionId !== request.expectedCurrentVersionId)
      throw new ArtifactsError("CONFLICT", "The artifact has a newer version", {
        currentVersionId: artifact.currentVersionId,
      });
    if (request.kind !== undefined && request.kind !== artifact.kind)
      throw new ArtifactsError(
        "BAD_REQUEST",
        "An artifact's kind cannot change",
      );
    return artifact;
  }

  async function openSession(
    request: CreateUploadRequest,
    digest: string,
    actor: Caller,
    requestId: string,
  ): Promise<CreateUploadResponse> {
    const board = await ensureBoard(request.board, actor, requestId);
    const artifact = await checkArtifact(request, board.id);
    const expiresAt = new Date(
      deps.now().getTime() +
        (await deps.settings.value("uploadTtlHours")) * HOUR_MS,
    );
    const session = await transact(db, async (tx) =>
      tx.uploadSession.create({
        data: {
          idempotencyKey: request.idempotencyKey,
          requestDigest: digest,
          boardId: board.id,
          artifactId: artifact?.id ?? null,
          request,
          expectedCurrentVersionId: request.expectedCurrentVersionId,
          createdById: actor.id,
          expiresAt,
          files: {
            create: request.files.map((file) => ({
              path: file.path,
              sha256: file.sha256,
              size: BigInt(file.size),
              mediaType: file.mediaType,
            })),
          },
        },
      }),
    );
    return {
      uploadId: session.id,
      missing: await missingDigests(
        db,
        request.files.map((file) => file.sha256),
      ),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** The same key and digest resume; a different digest is a conflict. */
  async function resume(
    session: SessionRow,
    digest: string,
  ): Promise<CreateUploadResponse> {
    if (session.requestDigest !== digest)
      throw new ArtifactsError(
        "CONFLICT",
        "The idempotency key was used for a different request",
      );
    return {
      uploadId: session.id,
      missing:
        session.committedVersionId === null
          ? await missingDigests(
              db,
              session.files.map((file) => file.sha256),
            )
          : [],
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  return {
    async create(
      request: CreateUploadRequest,
      actor: Caller,
      requestId: string,
    ): Promise<CreateUploadResponse> {
      await assertWritable(deps);
      await assertLimits(deps, request);
      const digest = await requestDigest(request);
      const find = () =>
        db.uploadSession.findUnique({
          where: { idempotencyKey: request.idempotencyKey },
          include: { files: true },
        });
      const existing = await find();
      if (existing !== null) {
        const expired =
          existing.committedVersionId === null &&
          existing.expiresAt <= deps.now();
        if (!expired) return resume(existing, digest);
        await db.uploadSession.delete({ where: { id: existing.id } });
      }
      try {
        return await openSession(request, digest, actor, requestId);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await find();
        if (raced === null) throw error;
        return resume(raced, digest);
      }
    },

    /** Loads a session a blob upload targets, refusing an expired or committed one. */
    async sessionForBlob(uploadId: string, sha256: string) {
      await assertWritable(deps);
      const session = await db.uploadSession.findUnique({
        where: { id: uploadId },
        include: { files: true },
      });
      if (session === null)
        throw new ArtifactsError("NOT_FOUND", "Upload not found");
      if (session.committedVersionId !== null)
        throw new ArtifactsError(
          "CONFLICT",
          "The upload was already committed",
        );
      if (session.expiresAt <= deps.now())
        throw new ArtifactsError("GONE", "The upload expired");
      const file = session.files.find((entry) => entry.sha256 === sha256);
      if (file === undefined)
        throw new ArtifactsError(
          "NOT_FOUND",
          "That digest is not in the upload's manifest",
        );
      return { session, size: Number(file.size) };
    },

    async blobExists(sha256: string): Promise<boolean> {
      return (await db.blob.count({ where: { sha256 } })) > 0;
    },

    /**
     * Records a verified object. Returns false when another upload recorded
     * the same digest first: the caller then deletes its own object.
     */
    async recordBlob(
      sha256: string,
      storageKey: string,
      size: number,
    ): Promise<boolean> {
      const result = await db.blob.createMany({
        data: [{ sha256, storageKey, size: BigInt(size) }],
        skipDuplicates: true,
      });
      return result.count === 1;
    },

    async commit(
      uploadId: string,
      actor: Caller,
      requestId: string,
    ): Promise<CommitUploadResponse> {
      await assertWritable(deps);
      return transact(db, async (tx) =>
        commitLocked(tx, deps, uploadId, { actor, requestId }),
      );
    },
  };
}

async function commitLocked(
  tx: Tx,
  deps: Deps,
  uploadId: string,
  audit: Audit,
): Promise<CommitUploadResponse> {
  await tx.$queryRaw`SELECT "id" FROM "UploadSession" WHERE "id" = ${uploadId} FOR UPDATE`;
  const session = await tx.uploadSession.findUnique({
    where: { id: uploadId },
    include: { files: true, board: true },
  });
  if (session === null)
    throw new ArtifactsError("NOT_FOUND", "Upload not found");
  if (session.committedVersionId !== null) {
    const version = await tx.version.findUniqueOrThrow({
      where: { id: session.committedVersionId },
    });
    return {
      artifactId: version.artifactId,
      versionId: version.id,
      number: version.number,
      reviewUrl: `${deps.origins.app}/a/${version.artifactId}`,
      boardUrl: `${deps.origins.app}/b/${session.board.slug}`,
    };
  }
  if (session.expiresAt <= deps.now())
    throw new ArtifactsError("GONE", "The upload expired");
  const request = CreateUploadRequestSchema.parse(session.request);
  const board = await lockBoardById(tx, session.boardId);
  const missing = await missingDigests(
    tx,
    session.files.map((file) => file.sha256),
  );
  const artifactId = await resolveArtifact(tx, session, request, {
    owner: audit.actor.workspaceKey ?? audit.actor.key,
    missing,
  });
  const total = session.files.reduce((sum, file) => sum + Number(file.size), 0);
  const artifact = await tx.artifact.update({
    where: { id: artifactId },
    data: { versionCounter: { increment: 1 } },
  });
  const version = await tx.version.create({
    data: {
      artifactId,
      number: artifact.versionCounter,
      contentToken: mintContentToken(),
      entryPath: request.entryPath,
      totalBytes: BigInt(total),
      note: request.note ?? "",
      viewport: request.viewport ?? Prisma.DbNull,
      publisherId: session.createdById,
      uploadId: session.id,
      files: {
        create: session.files.map((file) => ({
          path: file.path,
          sha256: file.sha256,
          mediaType: file.mediaType,
        })),
      },
    },
  });
  await tx.artifact.update({
    where: { id: artifactId },
    data: { currentVersionId: version.id, title: request.title },
  });
  await tx.uploadSession.update({
    where: { id: session.id },
    data: { committedVersionId: version.id, artifactId },
  });
  await tx.board.update({
    where: { id: board.id },
    data: { lastActivityAt: deps.now(), archivedAt: null, expiredAt: null },
  });
  await applyOpsLocked(
    tx,
    board,
    [{ op: "placeFrame", artifactId, ...placementOf(request) }],
    audit,
  );
  await recordEvents(tx, [
    {
      boardId: board.id,
      kind: "version.committed",
      entityId: version.id,
      actorId: audit.actor.id,
      requestId: audit.requestId,
      payload: { artifactId, number: version.number },
    },
  ]);
  return {
    artifactId,
    versionId: version.id,
    number: version.number,
    reviewUrl: `${deps.origins.app}/a/${artifactId}`,
    boardUrl: `${deps.origins.app}/b/${session.board.slug}`,
  };
}

function placementOf(request: CreateUploadRequest) {
  if (request.placement !== undefined) return request.placement;
  return request.viewport === undefined
    ? DEFAULT_FRAME
    : { w: request.viewport.width, h: request.viewport.height };
}

/**
 * The artifact a commit adds a version to, creating it for a first publish.
 * Locks the row, then checks the caller's compare-and-set token and that
 * every blob exists. Returns the artifact id.
 */
async function resolveArtifact(
  tx: Tx,
  session: SessionRow & { board: { id: string } },
  request: CreateUploadRequest,
  commit: { owner: string; missing: string[] },
): Promise<string> {
  if (session.artifactId !== null) {
    const rows = await tx.$queryRaw<{ currentVersionId: string | null }[]>`
      SELECT "currentVersionId" FROM "Artifact" WHERE "id" = ${session.artifactId} AND "deletedAt" IS NULL FOR UPDATE`;
    const locked = rows[0];
    if (locked === undefined)
      throw new ArtifactsError("NOT_FOUND", "Artifact not found");
    if (locked.currentVersionId !== session.expectedCurrentVersionId)
      throw new ArtifactsError("CONFLICT", "The artifact has a newer version", {
        currentVersionId: locked.currentVersionId,
      });
  }
  if (commit.missing.length > 0)
    throw new ArtifactsError("CONFLICT", "Some blobs have not been uploaded", {
      missing: commit.missing,
    });
  if (session.artifactId !== null) return session.artifactId;
  const created = await tx.artifact.create({
    data: {
      boardId: session.board.id,
      title: request.title,
      kind: request.kind ?? inferKind(request),
      ownerKey: commit.owner,
    },
  });
  return created.id;
}
