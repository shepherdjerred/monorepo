import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { BundleReportSchema } from "#shared/migration-handoff.ts";
import { MigrationBundleProtocolSchema } from "#shared/handoff/library-bundle.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import type { PlexCanonicalTarget } from "#shared/plex-binding/canonical.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { loadLibraryAssetParentV1 } from "#infrastructure/handoff/library-asset.ts";

type LibraryPlexParent = Awaited<ReturnType<typeof loadLibraryAssetParentV1>>;

type Entry = z.infer<typeof BundleReportSchema>["entries"][number];
type Media = Extract<MigrationRecord, { kind: "media" }>;
type Birth = {
  mediaId: string;
  kind: "movie" | "episode";
  references: Media["externalIds"];
  season: number | null;
  episode: number | null;
};
export type LibraryCanonicalBirth = Birth[];

/** Read immutable birth identity once; mutable review status is not historical authority. */
export async function readLibraryCanonicalBirth(
  tx: Prisma.TransactionClient,
  parent: LibraryPlexParent,
  budget: PublicationAuthorityReadBudget,
): Promise<LibraryCanonicalBirth> {
  const review = await tx.migrationBundleReview.findUniqueOrThrow({
    where: { id: parent.scope.request.bundleReviewId },
    include: { bundle: true },
  });
  budget.consume(2);
  const { reportHash, ...reportBody } = z
    .record(z.string(), z.json())
    .parse(review.report);
  const { bundleHash, ...manifestBody } = z
    .record(z.string(), z.json())
    .parse(review.bundle.manifest);
  if (
    reportHash !== review.reportHash ||
    reportHash !== parent.scope.request.reportHash ||
    snapshotHash(reportBody) !== reportHash ||
    bundleHash !== review.bundle.bundleHash ||
    bundleHash !== parent.scope.request.bundleHash ||
    snapshotHash(manifestBody) !== bundleHash
  )
    throw new Error(
      "Library canonical birth literal report or manifest changed",
    );
  const report = BundleReportSchema.parse(review.report);
  const manifest = MigrationBundleProtocolSchema.parse(review.bundle.manifest);
  if (report.bundleHash !== manifest.bundleHash)
    throw new Error("Library canonical birth report belongs to another bundle");
  const captures = manifest.captures.filter(
    (capture) => capture.captureId === parent.file.captureId,
  );
  const capture = captures[0];
  if (
    capture === undefined ||
    captures.length !== 1 ||
    capture.sourceKind !==
      (parent.file.libraryKind === "movies" ? "radarr" : "sonarr")
  )
    throw new Error("Library canonical birth source instance changed");
  const entries = report.entries.filter(
    (entry) => entry.captureHash === capture.captureHash,
  );
  return libraryCanonicalBirth(parent.file, entries);
}

export function libraryCanonicalBirth(
  file: Pick<
    LibraryPlexParent["file"],
    "provenanceKey" | "sourcePath" | "sizeBytes" | "libraryKind" | "mediaIds"
  >,
  entries: readonly Entry[],
): LibraryCanonicalBirth {
  const selected = entries.filter(
    (entry) => entry.provenanceKey === file.provenanceKey,
  );
  const entry = selected[0];
  if (
    entry === undefined ||
    selected.length !== 1 ||
    entry.sourceRecord.kind !== "file" ||
    entry.sourceRecord.path !== file.sourcePath ||
    String(entry.sourceRecord.sizeBytes) !== file.sizeBytes ||
    entry.observationHash !==
      snapshotHash(z.json().parse(entry.sourceRecord)) ||
    snapshotHash([...entry.mediaIds].sort()) !==
      snapshotHash([...file.mediaIds].sort()) ||
    entry.confidence !== "exact"
  )
    throw new Error("Library canonical birth file changed");
  const birth = entry.sourceRecord.mediaSourceIds.map((sourceId): Birth => {
    const leaf = sourceMedia(entries, sourceId);
    const record = leaf.sourceRecord;
    if (record.kind !== "media") throw new Error("Library birth media missing");
    if (file.libraryKind === "movies") {
      if (record.mediaKind !== "movie" || record.parentSourceId !== null)
        throw new Error("Library movie birth has an invalid hierarchy");
      return {
        mediaId: z.uuid().parse(leaf.mediaIds[0]),
        kind: "movie",
        references: record.externalIds,
        season: null,
        episode: null,
      };
    }
    if (record.mediaKind !== "episode" || record.parentSourceId === null)
      throw new Error("Library TV birth has no episode parent");
    const root = seriesOf(entries, record);
    return {
      mediaId: z.uuid().parse(leaf.mediaIds[0]),
      kind: "episode",
      references: root.externalIds,
      season: z.int().nonnegative().parse(record.season),
      episode: z.int().nonnegative().parse(record.episode),
    };
  });
  const ids = birth.map((item) => item.mediaId).sort();
  if (
    new Set(ids).size !== ids.length ||
    snapshotHash(ids) !== snapshotHash([...file.mediaIds].sort())
  )
    throw new Error("Library canonical birth lost complete physical coverage");
  return birth.sort((a, b) => a.mediaId.localeCompare(b.mediaId));
}

function sourceMedia(entries: readonly Entry[], sourceId: string): Entry {
  const matches = entries.filter(
    (entry) => entry.sourceId === sourceId && entry.kind === "media",
  );
  const entry = matches[0];
  if (
    entry === undefined ||
    matches.length !== 1 ||
    entry.confidence !== "exact" ||
    entry.mediaIds.length !== 1 ||
    entry.observationHash !== snapshotHash(z.json().parse(entry.sourceRecord))
  )
    throw new Error("Library canonical birth media is absent or ambiguous");
  return entry;
}

function seriesOf(entries: readonly Entry[], episode: Media): Media {
  let current = episode;
  const seen = new Set([current.sourceId]);
  for (let depth = 0; depth < 3; depth++) {
    if (current.parentSourceId === null)
      throw new Error("Library canonical birth series parent missing");
    const next = sourceMedia(entries, current.parentSourceId).sourceRecord;
    if (next.kind !== "media" || seen.has(next.sourceId))
      throw new Error("Library canonical birth hierarchy is cyclic");
    seen.add(next.sourceId);
    if (next.mediaKind === "series" && next.parentSourceId === null)
      return next;
    if (next.mediaKind !== "season" || next.season !== episode.season)
      throw new Error("Library canonical birth hierarchy changed");
    current = next;
  }
  throw new Error("Library canonical birth hierarchy exceeds its bound");
}

/** Added catalog IDs and title refreshes are safe; changed birth IDs or coordinates are not. */
export function assertLibraryCanonicalBirth(
  birth: LibraryCanonicalBirth,
  canonical: readonly PlexCanonicalTarget[],
) {
  if (birth.length !== canonical.length)
    throw new PlexBindingProtection("scope_changed");
  for (const original of birth) {
    const current = canonical.find(
      (target) => target.scope.mediaId === original.mediaId,
    );
    const references = Object.entries(original.references);
    if (
      current?.kind !== original.kind ||
      references.length === 0 ||
      !references.some(([namespace, value]) =>
        current.references.some(
          (reference) =>
            reference.namespace === namespace &&
            reference.value === String(value),
        ),
      ) ||
      references.some(([namespace, value]) =>
        current.references.some(
          (reference) =>
            reference.namespace === namespace &&
            reference.value !== String(value),
        ),
      ) ||
      (current.kind === "episode" &&
        (current.coordinate.seasonNumber !== original.season ||
          current.coordinate.episodeNumber !== original.episode))
    )
      throw new PlexBindingProtection("scope_changed");
  }
}
