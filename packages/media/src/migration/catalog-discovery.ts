import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { CatalogApplication } from "#application/ports.ts";
import { requireOwner, MediaError } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import type { TmdbClient } from "#integrations/tmdb.ts";
import { type MigrationRecord } from "#shared/migration.ts";
import {
  DiscoverMigrationCatalogSchema,
  MigrationDiscoveryResultSchema,
} from "#shared/migration-catalog.ts";
import { validateCapture } from "#migration/capture/capture-validation.ts";
import { canonicalOrder } from "./canonical-order.ts";
import { catalogIdentity } from "./catalog-targets.ts";

type Media = Extract<MigrationRecord, { kind: "media" }>;
type SourceIds = Media["externalIds"];
type Catalog = Pick<TmdbClient, "findExternal" | "seriesExternalIds" | "movie">;
async function resolveTmdb(
  media: Media,
  tmdb: Catalog,
): Promise<number | null> {
  if (media.externalIds.tmdb !== undefined) return media.externalIds.tmdb;
  const source = media.externalIds.tvdb === undefined ? "imdb_id" : "tvdb_id";
  const id =
    media.externalIds.tvdb === undefined
      ? media.externalIds.imdb
      : String(media.externalIds.tvdb);
  if (id === undefined) return null;
  const found = await tmdb.findExternal(source, id);
  const matches =
    media.mediaKind === "movie" ? found.movie_results : found.tv_results;
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}
function agrees(source: SourceIds, actual: SourceIds) {
  return (["tmdb", "tvdb", "imdb"] as const).every(
    (key) => source[key] === undefined || source[key] === actual[key],
  );
}
async function verifiedIdentity(media: Media, tmdb: Catalog) {
  const id = await resolveTmdb(media, tmdb);
  if (id === null) return null;
  if (media.mediaKind === "movie") {
    const movie = await tmdb.movie(id);
    const ids = {
      tmdb: movie.id,
      ...(movie.imdb_id === null ? {} : { imdb: movie.imdb_id }),
    };
    return movie.id === id && agrees(media.externalIds, ids) ? ids : null;
  }
  const series = await tmdb.seriesExternalIds(id);
  const ids = {
    tmdb: series.id,
    ...(series.tvdb_id === null ? {} : { tvdb: series.tvdb_id }),
    ...(series.imdb_id === null ? {} : { imdb: series.imdb_id }),
  };
  return series.id === id && agrees(media.externalIds, ids) ? ids : null;
}
export class MigrationCatalogDiscovery {
  constructor(
    private readonly db: Database,
    private readonly tmdb: Catalog,
    private readonly catalog: Pick<CatalogApplication, "adopt">,
  ) {}
  /** Bounded/resumable catalog-only prerequisite. Existing catalog projection owns TV episode expansion. */
  async discover(
    actor: MediaActor,
    captureId: string,
    value: z.input<typeof DiscoverMigrationCatalogSchema>,
  ) {
    requireOwner(actor);
    const input = DiscoverMigrationCatalogSchema.parse(value);
    const row = await this.db.migrationCapture.findUniqueOrThrow({
      where: { id: captureId },
    });
    const capture = validateCapture(row.manifest);
    if (
      capture.captureHash !== input.captureHash ||
      !capture.complete ||
      !capture.stable
    )
      throw new MediaError(
        "migration_capture_protected",
        "Catalog discovery requires the exact complete stable capture",
        409,
      );
    const roots = capture.snapshot.records
      .filter((record) => record.kind === "media")
      .filter(
        (record) =>
          record.mediaKind === "movie" || record.mediaKind === "series",
      )
      .sort((a, b) => canonicalOrder(a.sourceId, b.sourceId));
    if (input.cursor > roots.length)
      throw new MediaError(
        "invalid_cursor",
        "Catalog discovery cursor exceeds capture",
        422,
      );
    const entries = [];
    for (const media of roots.slice(input.cursor, input.cursor + 10))
      entries.push(await this.project(media));
    return MigrationDiscoveryResultSchema.parse({
      captureHash: capture.captureHash,
      nextCursor: input.cursor + 10 < roots.length ? input.cursor + 10 : null,
      entries,
      ownershipTransferred: false,
    });
  }
  private async project(media: Media) {
    const ids = await verifiedIdentity(media, this.tmdb);
    if (ids === null)
      return {
        sourceId: media.sourceId,
        mediaId: null,
        status: "protected",
        reason: "external_identity_missing_ambiguous_or_conflicting",
      };
    const kind = media.mediaKind === "movie" ? "movie" : "series";
    const existing = await this.db.mediaItem.findUnique({
      where: { kind_tmdbId: { kind, tmdbId: ids.tmdb } },
    });
    if (existing !== null && !agrees(catalogIdentity(existing), ids))
      return {
        sourceId: media.sourceId,
        mediaId: existing.id,
        status: "protected",
        reason: "catalog_identity_conflict",
      };
    const result =
      existing === null
        ? await this.catalog.adopt(kind, ids.tmdb)
        : { mediaId: existing.id };
    const item = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${result.mediaId} FOR UPDATE`;
      const current = await tx.mediaItem.findUniqueOrThrow({
        where: { id: result.mediaId },
      });
      if (!agrees(catalogIdentity(current), ids))
        throw new MediaError(
          "catalog_identity_conflict",
          "Catalog identity changed during discovery",
          409,
        );
      return await tx.mediaItem.update({
        where: { id: current.id },
        data: {
          externalIds: {
            ...z.record(z.string(), z.json()).parse(current.externalIds),
            ...ids,
          },
        },
      });
    });
    return {
      sourceId: media.sourceId,
      mediaId: item.id,
      status: item.catalogState === "ready" ? "ready" : "catalog_pending",
      reason:
        item.catalogState === "ready"
          ? null
          : "await_canonical_episode_projection",
    };
  }
}
