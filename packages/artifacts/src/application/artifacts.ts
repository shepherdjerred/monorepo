import type {
  ArtifactDetail,
  ArtifactSummary,
  VersionSummary,
  VersionView,
} from "#shared/procedures.ts";
import { mintContentToken } from "#domain/paths.ts";
import { transact } from "#infrastructure/database.ts";
import { applyOpsLocked, lockBoardById } from "./boards.ts";
import { ArtifactsError } from "./errors.ts";
import { recordEvents } from "./events.ts";
import type { Caller, Deps } from "./types.ts";
import {
  ARTIFACT_INCLUDE,
  contentUrl,
  openThreadCounts,
  presentArtifact,
  presentVersion,
  VERSION_INCLUDE,
} from "./views.ts";

export function createArtifacts(deps: Deps) {
  const { db } = deps;

  async function summaryOf(id: string): Promise<ArtifactSummary> {
    const artifact = await db.artifact.findFirst({
      where: { id, deletedAt: null },
      include: ARTIFACT_INCLUDE,
    });
    if (artifact === null)
      throw new ArtifactsError("NOT_FOUND", "Artifact not found");
    const threads = await openThreadCounts(db, [id]);
    return presentArtifact(artifact, threads.get(id) ?? 0);
  }

  async function viewOf(id: string): Promise<VersionView> {
    const version = await db.version.findUnique({
      where: { id },
      include: { ...VERSION_INCLUDE, files: { orderBy: { path: "asc" } } },
    });
    if (version === null)
      throw new ArtifactsError("NOT_FOUND", "Version not found");
    const sizes = await db.blob.findMany({
      where: { sha256: { in: version.files.map((file) => file.sha256) } },
      select: { sha256: true, size: true },
    });
    const sizeOf = new Map(
      sizes.map((blob) => [blob.sha256, Number(blob.size)]),
    );
    return {
      ...presentVersion(version),
      contentUrl:
        version.purgedAt === null
          ? contentUrl(deps.origins.content, version.contentToken)
          : null,
      files: version.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        size: sizeOf.get(file.sha256) ?? 0,
        mediaType: file.mediaType,
      })),
    };
  }

  return {
    async list(input: {
      board?: string | undefined;
      ownerKey?: string | undefined;
      limit: number;
    }): Promise<ArtifactSummary[]> {
      const artifacts = await db.artifact.findMany({
        where: {
          deletedAt: null,
          ...(input.board === undefined
            ? {}
            : { board: { slug: input.board } }),
          ...(input.ownerKey === undefined ? {} : { ownerKey: input.ownerKey }),
        },
        include: ARTIFACT_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
      const threads = await openThreadCounts(
        db,
        artifacts.map((a) => a.id),
      );
      return artifacts.map((artifact) =>
        presentArtifact(artifact, threads.get(artifact.id) ?? 0),
      );
    },

    async get(id: string): Promise<ArtifactDetail> {
      const summary = await summaryOf(id);
      return {
        ...summary,
        current:
          summary.currentVersion === null
            ? null
            : await viewOf(summary.currentVersion.id),
      };
    },

    async rename(
      input: { id: string; title: string },
      actor: Caller,
      requestId: string,
    ): Promise<ArtifactSummary> {
      await transact(db, async (tx) => {
        const artifact = await tx.artifact.findFirst({
          where: { id: input.id, deletedAt: null },
        });
        if (artifact === null)
          throw new ArtifactsError("NOT_FOUND", "Artifact not found");
        await tx.artifact.update({
          where: { id: input.id },
          data: { title: input.title },
        });
        await recordEvents(tx, [
          {
            boardId: artifact.boardId,
            kind: "artifact.renamed",
            entityId: artifact.id,
            actorId: actor.id,
            requestId,
          },
        ]);
      });
      return summaryOf(input.id);
    },

    async delete(
      id: string,
      actor: Caller,
      requestId: string,
    ): Promise<{ ok: true }> {
      await transact(db, async (tx) => {
        const artifact = await tx.artifact.findFirst({
          where: { id, deletedAt: null },
        });
        if (artifact === null)
          throw new ArtifactsError("NOT_FOUND", "Artifact not found");
        const board = await lockBoardById(tx, artifact.boardId);
        await tx.artifact.update({
          where: { id },
          data: { deletedAt: deps.now() },
        });
        await applyOpsLocked(
          tx,
          board,
          [{ op: "removeFrame", artifactId: id }],
          { actor, requestId },
        );
        await recordEvents(tx, [
          {
            boardId: artifact.boardId,
            kind: "artifact.deleted",
            entityId: id,
            actorId: actor.id,
            requestId,
            payload: { artifactId: id },
          },
        ]);
      });
      const versions = await db.version.findMany({
        where: { artifactId: id },
        select: { id: true },
      });
      for (const version of versions) deps.tokens.invalidateVersion(version.id);
      return { ok: true };
    },

    async versions(id: string): Promise<VersionSummary[]> {
      await summaryOf(id);
      const versions = await db.version.findMany({
        where: { artifactId: id },
        include: VERSION_INCLUDE,
        orderBy: { number: "desc" },
      });
      return versions.map((version) => presentVersion(version));
    },

    version: viewOf,

    /** New token, old one dead at once: the next request for it is a 404. */
    async rotateToken(
      id: string,
      actor: Caller,
      requestId: string,
    ): Promise<{ contentUrl: string }> {
      const token = mintContentToken();
      const previous = await transact(db, async (tx) => {
        const version = await tx.version.findUnique({
          where: { id },
          include: { artifact: true },
        });
        if (version === null)
          throw new ArtifactsError("NOT_FOUND", "Version not found");
        if (version.purgedAt !== null)
          throw new ArtifactsError("GONE", "The version's content was purged");
        await tx.version.update({
          where: { id },
          data: { contentToken: token },
        });
        await recordEvents(tx, [
          {
            boardId: version.artifact.boardId,
            kind: "version.token_rotated",
            entityId: id,
            actorId: actor.id,
            requestId,
          },
        ]);
        return version.contentToken;
      });
      deps.tokens.invalidateToken(previous);
      return { contentUrl: contentUrl(deps.origins.content, token) };
    },
  };
}
