import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { queueUpgradeCleanupPage } from "./upgrade-cleanup.ts";
import { queueNativeArchivePage } from "./native-archive.ts";
import { queueExistingPlexBinding } from "#automation/plex-binding/queue.ts";

const ProgressSchema = z.object({
  section: z.number().int().min(0).max(4),
  offset: z.number().int().nonnegative(),
  assetCursor: z.string().nullable().default(null),
  archiveCursor: z.string().nullable().default(null),
});

/** Records unowned inventory as observations only. Missing paths require a complete scan. */
export async function sweepInventory(
  context: MediaAutomationContext,
  scanId: string,
) {
  const scan = await context.db.reconciliationScan.upsert({
    where: { id: scanId },
    create: {
      id: scanId,
      kind: "inventory",
      progress: { section: 0, offset: 0 },
    },
    update: {},
  });
  if (scan.state === "completed") return { processed: 0, nextCursor: null };
  const progress = ProgressSchema.parse(scan.progress);
  if (progress.section === 4)
    return reconcileArchives(context, scanId, progress.archiveCursor);
  if (progress.section === 3)
    return reconcileCleanup(context, scanId, progress.assetCursor);
  if (progress.section === 2)
    return reconcileInventory(context, scanId, progress.assetCursor);
  const permitted = await context.permittedSections();
  const sectionId = progress.section === 0 ? permitted.movie : permitted.series;
  const kind = progress.section === 0 ? "movie" : "episode";
  const sections = await context.plex.sections();
  if (
    !sections.some(
      (section) =>
        section.key === sectionId &&
        section.type === (kind === "movie" ? "movie" : "show"),
    )
  )
    throw new Error("Configured Plex library is unavailable");
  const page = await context.plex.libraryPage({
    sectionId,
    kind,
    offset: progress.offset,
    limit: 100,
  });
  if (page.items.length === 0 && progress.offset < page.total)
    throw new Error("Plex inventory returned an incomplete page");
  const offset = progress.offset + page.items.length;
  const next =
    offset >= page.total
      ? { section: progress.section + 1, offset: 0 }
      : { section: progress.section, offset };
  await serializable(context.db, async (tx) => {
    const current = await tx.reconciliationScan.findUniqueOrThrow({
      where: { id: scanId },
    });
    if (JSON.stringify(current.progress) !== JSON.stringify(scan.progress))
      return;
    for (const item of page.items) {
      for (const media of item.Media ?? [])
        for (const part of media.Part) {
          const fields = {
            kind,
            guids: item.Guid ?? [],
            seasonNumber: item.parentIndex ?? null,
            episodeNumber: item.index ?? null,
            scanId,
            observedAt: new Date(),
          };
          await tx.plexInventoryObservation.upsert({
            where: {
              sectionId_ratingKey_path: {
                sectionId,
                ratingKey: item.ratingKey,
                path: part.file,
              },
            },
            create: {
              sectionId,
              ratingKey: item.ratingKey,
              path: part.file,
              ...fields,
            },
            update: fields,
          });
        }
    }
    await tx.reconciliationScan.update({
      where: { id: scanId },
      data: { progress: next },
    });
  });
  return {
    processed: page.items.length,
    nextCursor: `${String(next.section)}:${String(next.offset)}`,
  };
}

async function reconcileInventory(
  context: MediaAutomationContext,
  scanId: string,
  cursor: string | null,
) {
  const assets = await context.db.libraryAsset.findMany({
    where: {
      owned: true,
      state: "published",
      ...(cursor === null ? {} : { id: { gt: cursor } }),
    },
    take: 25,
    orderBy: { id: "asc" },
    include: { coverage: { where: { current: true } } },
  });
  for (const asset of assets) {
    if (
      asset.edition !== "default" ||
      asset.coverage.some((coverage) => coverage.edition !== "default")
    ) {
      // Keep unexpected physical inventory visible without attributing it to a
      // legacy default title or granting it publication/cleanup authority.
      await context.db.applicationEvent.upsert({
        where: { dedupeKey: `inventory-edition:${scanId}:${asset.id}` },
        create: {
          dedupeKey: `inventory-edition:${scanId}:${asset.id}`,
          kind: "inventory_edition_unavailable",
          payload: { scanId, assetId: asset.id, assetVersion: asset.version },
        },
        update: {},
      });
      continue;
    }
    await queueExistingPlexBinding(context, asset.id);
    const observation = await context.db.plexInventoryObservation.findFirst({
      where: { scanId, path: asset.path },
    });
    if (observation !== null) continue;
    // An absent Plex listing is diagnostic evidence, never authorization to delete,
    // claim foreign files, or mutate current watched/availability projections.
    for (const coverage of asset.coverage) {
      const prior = await context.db.applicationEvent.findFirst({
        where: {
          mediaId: coverage.mediaId,
          kind: "inventory_path_unobserved",
          payload: { path: ["scanId"], equals: scanId },
        },
      });
      if (prior === null)
        await context.db.applicationEvent.create({
          data: {
            mediaId: coverage.mediaId,
            kind: "inventory_path_unobserved",
            payload: { scanId, assetId: asset.id, assetVersion: asset.version },
          },
        });
    }
  }
  const nextCursor = assets.length === 25 ? (assets.at(-1)?.id ?? null) : null;
  await context.db.reconciliationScan.update({
    where: { id: scanId },
    data: {
      progress: {
        section: nextCursor === null ? 3 : 2,
        offset: 0,
        assetCursor: nextCursor,
      },
    },
  });
  return {
    processed: assets.length,
    nextCursor: nextCursor === null ? "cleanup" : `assets:${nextCursor}`,
  };
}

async function reconcileCleanup(
  context: MediaAutomationContext,
  scanId: string,
  cursor: string | null,
) {
  const result = await queueUpgradeCleanupPage(context, { scanId, cursor });
  await context.db.reconciliationScan.update({
    where: { id: scanId },
    data: {
      progress: {
        section: result.nextCursor === null ? 4 : 3,
        offset: 0,
        assetCursor: result.nextCursor,
        archiveCursor: null,
      },
    },
  });
  return { ...result, nextCursor: result.nextCursor ?? "archives" };
}

async function reconcileArchives(
  context: MediaAutomationContext,
  scanId: string,
  cursor: string | null,
) {
  const result = await queueNativeArchivePage(context, { scanId, cursor });
  await context.db.reconciliationScan.update({
    where: { id: scanId },
    data: {
      progress: {
        section: 4,
        offset: 0,
        assetCursor: null,
        archiveCursor: result.nextCursor,
      },
      ...(result.nextCursor === null
        ? { state: "completed", completedAt: new Date() }
        : {}),
    },
  });
  return result;
}
