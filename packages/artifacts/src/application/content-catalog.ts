import type { Database } from "#infrastructure/database.ts";

export type CatalogVersion = {
  versionId: string;
  artifactId: string;
  kind: string;
  entryPath: string;
};

export type CatalogFile = {
  sha256: string;
  size: number;
  storageKey: string;
  mediaType: string;
};

/**
 * What the content host needs to know: a token's version and a version's
 * files. A purged version or deleted artifact resolves to nothing.
 */
export type ContentCatalog = {
  findVersion: (token: string) => Promise<CatalogVersion | null>;
  findFile: (versionId: string, path: string) => Promise<CatalogFile | null>;
};

export function createContentCatalog(db: Database): ContentCatalog {
  return {
    async findVersion(token) {
      const version = await db.version.findUnique({
        where: { contentToken: token },
        include: {
          artifact: { select: { id: true, kind: true, deletedAt: true } },
        },
      });
      if (version === null) return null;
      if (version.purgedAt !== null || version.artifact.deletedAt !== null)
        return null;
      return {
        versionId: version.id,
        artifactId: version.artifact.id,
        kind: version.artifact.kind,
        entryPath: version.entryPath,
      };
    },
    async findFile(versionId, path) {
      const file = await db.versionFile.findUnique({
        where: { versionId_path: { versionId, path } },
        include: { blob: true },
      });
      return file === null
        ? null
        : {
            sha256: file.sha256,
            size: Number(file.blob.size),
            storageKey: file.blob.storageKey,
            mediaType: file.mediaType,
          };
    },
  };
}
