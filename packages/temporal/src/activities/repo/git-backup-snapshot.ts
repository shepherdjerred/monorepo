import { createHash } from "node:crypto";
import path from "node:path";
import {
  computeMirrorRefDigest,
  createZstdGitBundle,
  syncBareMirror,
  syncWikiMirror,
  type GitAuthContext,
  type GitSubprocessHooks,
} from "./git-backup-git.ts";
import {
  createZstdLfsArchive,
  inspectMirrorLfsObjects,
  type LfsInventory,
} from "./git-backup-lfs.ts";
import type {
  DiscoveredGitRepository,
  GitBackupConfig,
} from "./git-backup-report.ts";
import {
  selectSnapshotKeysToPrune,
  snapshotObjectKeys,
  type GitBackupLatestManifest,
  type GitBackupObjectStore,
} from "./git-backup-store.ts";

export type MirrorObservation = {
  readonly mirrorPath: string;
  readonly wikiMirrorPath: string;
  readonly refCount: number;
  readonly refDigest: string;
  readonly lfsInventory: LfsInventory;
  readonly wikiStatus: "mirrored" | "uninitialized" | "disabled";
  readonly wikiRefCount: number;
  readonly wikiRefDigest: string | null;
};

export async function observeRepositoryMirrors(input: {
  readonly repo: DiscoveredGitRepository;
  readonly config: GitBackupConfig;
  readonly mirrorRootDir: string;
  readonly auth: GitAuthContext;
  readonly hooks: GitSubprocessHooks;
  readonly resolveLfsBinary?: (() => string | null) | undefined;
}): Promise<MirrorObservation> {
  const { repo, config, mirrorRootDir, auth, hooks } = input;
  const mirrorPath = path.join(mirrorRootDir, repo.owner, `${repo.name}.git`);
  const wikiMirrorPath = path.join(
    mirrorRootDir,
    repo.owner,
    `${repo.name}.wiki.git`,
  );

  await syncBareMirror({
    mirrorPath,
    cloneUrl: repo.cloneUrl,
    repoLabel: repo.fullName,
    includeLfs: config.includeLfs,
    auth,
    hooks,
    resolveLfsBinary: input.resolveLfsBinary,
  });

  let wikiStatus: "mirrored" | "uninitialized" | "disabled" = "disabled";
  let wikiRefCount = 0;
  let wikiRefDigest: string | null = null;
  if (config.includeWiki && repo.hasWiki && repo.wikiCloneUrl !== undefined) {
    wikiStatus = await syncWikiMirror({
      wikiMirrorPath,
      wikiCloneUrl: repo.wikiCloneUrl,
      repoLabel: repo.fullName,
      auth,
      hooks,
    });
    if (wikiStatus === "mirrored") {
      const wikiRefs = await computeMirrorRefDigest({
        mirrorPath: wikiMirrorPath,
        repoLabel: `${repo.fullName}.wiki`,
        auth,
        hooks,
      });
      wikiRefCount = wikiRefs.refCount;
      wikiRefDigest = wikiRefs.refDigest;
    }
  }

  const { refCount, refDigest } = await computeMirrorRefDigest({
    mirrorPath,
    repoLabel: repo.fullName,
    auth,
    hooks,
  });
  const lfsInventory: LfsInventory = config.includeLfs
    ? await inspectMirrorLfsObjects(mirrorPath)
    : { objectCount: 0, digest: null, files: [] };

  return {
    mirrorPath,
    wikiMirrorPath,
    refCount,
    refDigest,
    lfsInventory,
    wikiStatus,
    wikiRefCount,
    wikiRefDigest,
  };
}

export function isSnapshotStateUnchanged(
  existingLatest: GitBackupLatestManifest,
  observation: MirrorObservation,
  issuesDigest: string,
): boolean {
  const hasRequiredKeys =
    (observation.refCount === 0 || existingLatest.bundleKey !== null) &&
    (observation.lfsInventory.objectCount === 0 ||
      existingLatest.lfsKey !== null) &&
    (observation.wikiRefCount === 0 || existingLatest.wikiBundleKey !== null);

  return (
    hasRequiredKeys &&
    existingLatest.refDigest === observation.refDigest &&
    existingLatest.lfsDigest === observation.lfsInventory.digest &&
    existingLatest.wikiStatus === observation.wikiStatus &&
    existingLatest.wikiRefDigest === observation.wikiRefDigest &&
    existingLatest.issuesDigest === issuesDigest
  );
}

export function buildSnapshotId(
  capturedAt: string,
  observation: MirrorObservation,
  issuesDigest: string,
): string {
  const compositeDigest = createHash("sha256")
    .update(
      JSON.stringify({
        refDigest: observation.refDigest,
        lfsDigest: observation.lfsInventory.digest,
        wikiStatus: observation.wikiStatus,
        wikiRefDigest: observation.wikiRefDigest,
        issuesDigest,
      }),
      "utf8",
    )
    .digest("hex");
  const utcStamp = `${capturedAt.slice(0, 10)}T${capturedAt.slice(11, 19).replaceAll(":", "")}Z`;
  return `${utcStamp}-${compositeDigest.slice(0, 12)}`;
}

type ArtifactResolutionContext = {
  readonly repo: DiscoveredGitRepository;
  readonly snapshotId: string;
  readonly observation: MirrorObservation;
  readonly existingLatest: GitBackupLatestManifest | undefined;
  readonly store: GitBackupObjectStore;
  readonly scratchDir: string;
  readonly auth: GitAuthContext;
  readonly hooks: GitSubprocessHooks;
};

async function resolveMainBundleKey(
  ctx: ArtifactResolutionContext,
  targetKey: string,
): Promise<string | null> {
  if (ctx.observation.refCount === 0) {
    return null;
  }
  if (
    ctx.existingLatest?.refDigest === ctx.observation.refDigest &&
    ctx.existingLatest.bundleKey !== null
  ) {
    return ctx.existingLatest.bundleKey;
  }
  const localBundleZst = path.join(
    ctx.scratchDir,
    `${ctx.snapshotId}.bundle.zst`,
  );
  await createZstdGitBundle({
    mirrorPath: ctx.observation.mirrorPath,
    outputZstPath: localBundleZst,
    repoLabel: ctx.repo.fullName,
    auth: ctx.auth,
    hooks: ctx.hooks,
  });
  await ctx.store.putFile(targetKey, localBundleZst, "application/zstd");
  return targetKey;
}

async function resolveLfsArchiveKey(
  ctx: ArtifactResolutionContext,
  targetKey: string,
): Promise<string | null> {
  if (ctx.observation.lfsInventory.objectCount === 0) {
    return null;
  }
  if (
    ctx.existingLatest?.lfsDigest === ctx.observation.lfsInventory.digest &&
    ctx.existingLatest.lfsKey !== null
  ) {
    return ctx.existingLatest.lfsKey;
  }
  const localLfsZst = path.join(
    ctx.scratchDir,
    `${ctx.snapshotId}.lfs.tar.zst`,
  );
  await createZstdLfsArchive({
    inventory: ctx.observation.lfsInventory,
    outputZstPath: localLfsZst,
  });
  await ctx.store.putFile(targetKey, localLfsZst, "application/zstd");
  return targetKey;
}

async function resolveWikiBundleKey(
  ctx: ArtifactResolutionContext,
  targetKey: string,
): Promise<string | null> {
  if (
    ctx.observation.wikiStatus !== "mirrored" ||
    ctx.observation.wikiRefCount === 0
  ) {
    return null;
  }
  if (
    ctx.existingLatest?.wikiStatus === "mirrored" &&
    ctx.existingLatest.wikiRefDigest === ctx.observation.wikiRefDigest &&
    ctx.existingLatest.wikiBundleKey !== null
  ) {
    return ctx.existingLatest.wikiBundleKey;
  }
  const localWikiZst = path.join(
    ctx.scratchDir,
    `${ctx.snapshotId}.wiki.bundle.zst`,
  );
  await createZstdGitBundle({
    mirrorPath: ctx.observation.wikiMirrorPath,
    outputZstPath: localWikiZst,
    repoLabel: `${ctx.repo.fullName}.wiki`,
    auth: ctx.auth,
    hooks: ctx.hooks,
  });
  await ctx.store.putFile(targetKey, localWikiZst, "application/zstd");
  return targetKey;
}

export async function resolveSnapshotArtifacts(
  ctx: ArtifactResolutionContext,
): Promise<{
  bundleKey: string | null;
  lfsKey: string | null;
  wikiBundleKey: string | null;
}> {
  const keys = snapshotObjectKeys(
    ctx.repo.owner,
    ctx.repo.name,
    ctx.snapshotId,
  );
  const bundleKey = await resolveMainBundleKey(ctx, keys.bundleKey);
  const lfsKey = await resolveLfsArchiveKey(ctx, keys.lfsKey);
  const wikiBundleKey = await resolveWikiBundleKey(ctx, keys.wikiBundleKey);
  return { bundleKey, lfsKey, wikiBundleKey };
}

export async function pruneExpiredSnapshots(input: {
  readonly store: GitBackupObjectStore;
  readonly prefix: string;
  readonly keepSnapshots: number;
  readonly manifest: GitBackupLatestManifest;
}): Promise<number> {
  const allSnapshotKeys = await input.store.listKeys(input.prefix);
  const keysToDelete = selectSnapshotKeysToPrune({
    keys: allSnapshotKeys,
    keep: input.keepSnapshots,
    currentSnapshotId: input.manifest.snapshotId,
    protectedKeys: [
      input.manifest.bundleKey,
      input.manifest.lfsKey,
      input.manifest.wikiBundleKey,
      input.manifest.issuesKey,
    ],
  });
  if (keysToDelete.length > 0) {
    await input.store.deleteKeys(keysToDelete);
  }
  return keysToDelete.length;
}
