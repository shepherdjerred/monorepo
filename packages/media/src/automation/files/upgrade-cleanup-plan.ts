import nodePath from "node:path";
import { storedFilePath } from "./paths/locations.ts";
import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type {
  LibraryAsset,
  SubtitleAsset,
  MediaKind,
} from "#generated/prisma/client.ts";
import { FileGuardError, type FileContext } from "./types.ts";
import { fileOperations } from "./file-operations.ts";
import {
  ownedSubtitleSidecars,
  videoSubtitleWhere,
} from "./subtitle-lifecycle/ownership.ts";
import * as cleanupContract from "#shared/native-recovery/archive-plan.ts";

export const UpgradeCleanupPlanSchema =
  cleanupContract.UpgradeCleanupPlanSchema;
export type UpgradeCleanupPlan = cleanupContract.UpgradeCleanupPlan;

type CleanupAsset = Pick<
  LibraryAsset,
  "owned" | "state" | "checksum" | "version" | "path" | "ownershipEpoch"
> & {
  coverage: { mediaId: string; media: { kind: MediaKind } }[];
  subtitles: SubtitleAsset[];
};

/** Pure descriptor derivation. It neither certifies journals nor mutates historical cleanup rows. */
export function deriveUpgradeCleanupPlan(input: {
  asset: CleanupAsset;
  successor: Pick<LibraryAsset, "owned" | "state" | "checksum">;
  controlRoot: string;
}): UpgradeCleanupPlan {
  const { asset, successor, controlRoot } = input;
  if (
    !asset.owned ||
    asset.state !== "superseded" ||
    asset.checksum === null ||
    successor.checksum === null ||
    !successor.owned ||
    !["published", "superseded", "purged"].includes(successor.state)
  )
    throw new FileGuardError("cleanup_ownership_changed");
  const kind = asset.coverage[0]?.media.kind;
  if (kind !== "movie" && kind !== "episode")
    throw new FileGuardError("cleanup_coverage_unknown");
  return UpgradeCleanupPlanSchema.parse({
    libraryKind: kind === "movie" ? "movies" : "tv",
    assetVersion: asset.version,
    successorChecksum: successor.checksum,
    mediaIds: asset.coverage.map((item) => item.mediaId).sort(),
    files: [
      {
        location: "rollback",
        id: controlId(controlRoot, asset.path, "rollback"),
        path: asset.path,
        checksum: asset.checksum,
        subtitleId: null,
      },
      ...sidecarFiles(controlRoot, ownedSubtitleSidecars(asset)),
    ],
  });
}

export async function prepareUpgradeCleanupPlan(
  context: FileContext,
  cleanupId: string,
): Promise<UpgradeCleanupPlan> {
  const cleanup = await context.db.upgradeCleanup.findUniqueOrThrow({
    where: { id: cleanupId },
    include: {
      asset: {
        include: {
          coverage: { include: { media: true } },
          subtitles: { where: videoSubtitleWhere, orderBy: { id: "asc" } },
        },
      },
    },
  });
  if (cleanup.manifest !== null)
    return UpgradeCleanupPlanSchema.parse(cleanup.manifest);
  const successor = await context.db.libraryAsset.findUniqueOrThrow({
    where: { id: cleanup.successorAssetId },
  });
  const asset = cleanup.asset;
  if (
    !asset.owned ||
    asset.state !== "superseded" ||
    asset.checksum === null ||
    successor.checksum === null ||
    !successor.owned ||
    !["published", "superseded", "purged"].includes(successor.state)
  )
    throw new FileGuardError("cleanup_ownership_changed");
  const kind = asset.coverage[0]?.media.kind;
  if (kind !== "movie" && kind !== "episode")
    throw new FileGuardError("cleanup_coverage_unknown");
  const libraryKind = kind === "movie" ? "movies" : "tv";
  const roots = context.roots[libraryKind];
  const controlRoot = storedFilePath(context, libraryKind, "control", "");
  const importId = controlId(controlRoot, asset.path, "rollback");
  const operations = fileOperations(context, roots, () =>
    Promise.reject(new Error("Cleanup planning cannot mutate files")),
  );
  const journal = await operations.readManifest(importId);
  if (
    journal?.kind !== "import" ||
    journal.phase !== "complete" ||
    journal.previousSha256 !== asset.checksum ||
    journal.sha256 !== successor.checksum
  )
    throw new FileGuardError("cleanup_import_unproven");
  const plan = deriveUpgradeCleanupPlan({
    asset,
    successor,
    controlRoot,
  });
  await context.db.upgradeCleanup.updateMany({
    where: {
      id: cleanupId,
      version: cleanup.version,
      manifest: { equals: Prisma.DbNull },
    },
    data: { manifest: plan, version: { increment: 1 } },
  });
  const stored = await context.db.upgradeCleanup.findUniqueOrThrow({
    where: { id: cleanupId },
  });
  return UpgradeCleanupPlanSchema.parse(stored.manifest);
}

function sidecarFiles(
  controlRoot: string,
  subtitles: readonly SubtitleAsset[],
): UpgradeCleanupPlan["files"] {
  const files: UpgradeCleanupPlan["files"] = [];
  for (const subtitle of subtitles) {
    if (subtitle.path === null) continue;
    if (subtitle.state !== "superseded")
      throw new FileGuardError("cleanup_sidecar_referenced");
    const evidence = z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .safeParse(subtitle.checksum);
    if (!evidence.success) throw new FileGuardError("cleanup_sidecar_unproven");
    files.push({
      location: "quarantine",
      id: controlId(controlRoot, subtitle.path, "quarantine"),
      path: subtitle.path,
      checksum: evidence.data,
      subtitleId: subtitle.id,
    });
  }
  return files;
}

function controlId(root: string, path: string, location: string): string {
  const id = nodePath.relative(nodePath.join(root, location), path);
  if (!/^[\w-]{1,100}$/u.test(id) || nodePath.join(root, location, id) !== path)
    throw new FileGuardError("cleanup_path_unowned");
  return id;
}
