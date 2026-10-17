import nodePath from "node:path";
import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type { SubtitleAsset } from "#generated/prisma/client.ts";
import { FileGuardError, type FileContext } from "./types.ts";
import { fileOperations } from "./file-operations.ts";
import { ownedSubtitleSidecars } from "./subtitle-lifecycle/ownership.ts";

export const UpgradeCleanupPlanSchema = z.object({
  libraryKind: z.enum(["movies", "tv"]),
  assetVersion: z.number().int(),
  successorChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  mediaIds: z.array(z.string()).min(1),
  files: z
    .array(
      z.object({
        location: z.enum(["rollback", "quarantine"]),
        id: z.string().regex(/^[\w-]{1,100}$/u),
        path: z.string(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/u),
        subtitleId: z.string().nullable(),
      }),
    )
    .min(1),
});
export type UpgradeCleanupPlan = z.infer<typeof UpgradeCleanupPlanSchema>;

export async function prepareUpgradeCleanupPlan(
  context: FileContext,
  cleanupId: string,
): Promise<UpgradeCleanupPlan> {
  const cleanup = await context.db.upgradeCleanup.findUniqueOrThrow({
    where: { id: cleanupId },
    include: {
      asset: {
        include: { coverage: { include: { media: true } }, subtitles: true },
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
  const importId = controlId(roots.control, asset.path, "rollback");
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
  const files: UpgradeCleanupPlan["files"] = [
    {
      location: "rollback",
      id: importId,
      path: asset.path,
      checksum: asset.checksum,
      subtitleId: null,
    },
  ];
  files.push(...sidecarFiles(roots.control, ownedSubtitleSidecars(asset)));
  const plan = UpgradeCleanupPlanSchema.parse({
    libraryKind,
    assetVersion: asset.version,
    successorChecksum: successor.checksum,
    mediaIds: asset.coverage.map((item) => item.mediaId).sort(),
    files,
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
      .object({ checksum: z.string().regex(/^[a-f0-9]{64}$/u) })
      .safeParse(subtitle.provenance);
    if (!evidence.success) throw new FileGuardError("cleanup_sidecar_unproven");
    files.push({
      location: "quarantine",
      id: controlId(controlRoot, subtitle.path, "quarantine"),
      path: subtitle.path,
      checksum: evidence.data.checksum,
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
