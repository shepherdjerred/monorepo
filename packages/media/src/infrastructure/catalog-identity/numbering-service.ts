import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import type { TmdbClient } from "#integrations/tmdb.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import {
  NumberingGroupListSchema,
  type PreviewNumberingGroup,
  type CommitNumberingGroup,
} from "#shared/acquisition/numbering.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { numberingCatalog } from "./numbering-snapshot.ts";
import {
  loadNumberingGroup,
  numberingGroupDetail,
  buildNumberingPreview,
} from "./numbering-preview.ts";
import {
  assertNumberingOwner,
  writeNumberingMapping,
} from "./numbering-write.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";

export class CatalogNumberingAdministration extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly tmdb: TmdbClient,
  ) {
    super(db, { keepDays: 30 });
  }
  async groups(actor: MediaActor, seriesId: string) {
    requireOwner(actor);
    await assertNumberingOwner(this.db, actor.id, false);
    const catalog = await numberingCatalog(this.db, seriesId);
    const result = await this.tmdb.episodeGroups(
      z.int().positive().parse(catalog.series.tmdbId),
    );
    return NumberingGroupListSchema.parse({
      seriesId,
      seriesVersion: catalog.series.version,
      groups: result.groups,
    });
  }
  async group(actor: MediaActor, seriesId: string, groupId: string) {
    requireOwner(actor);
    await assertNumberingOwner(this.db, actor.id, false);
    const catalog = await numberingCatalog(this.db, seriesId);
    return numberingGroupDetail(
      seriesId,
      await loadNumberingGroup(
        this.tmdb,
        z.int().positive().parse(catalog.series.tmdbId),
        groupId,
      ),
    );
  }
  async previewGroup(
    actor: MediaActor,
    seriesId: string,
    input: PreviewNumberingGroup,
  ) {
    requireOwner(actor);
    await assertNumberingOwner(this.db, actor.id, false);
    const catalog = await numberingCatalog(this.db, seriesId);
    const group = await loadNumberingGroup(
      this.tmdb,
      z.int().positive().parse(catalog.series.tmdbId),
      input.groupId,
    );
    return buildNumberingPreview(catalog, group, input);
  }
  async commitGroup(
    actor: MediaActor,
    key: string,
    seriesId: string,
    input: CommitNumberingGroup,
  ) {
    requireOwner(actor);
    const initial = await numberingCatalog(this.db, seriesId);
    const group = await loadNumberingGroup(
      this.tmdb,
      z.int().positive().parse(initial.series.tmdbId),
      input.interpretation.groupId,
    );
    return await this.command(
      actor,
      key,
      { kind: "map_tmdb_group", input: { seriesId, ...input } },
      async (tx) => {
        await lockAcquisitionMedia(tx, [seriesId]);
        const catalog = await numberingCatalog(tx, seriesId);
        await lockAcquisitionMedia(
          tx,
          catalog.episodes.map((item) => item.id),
        );
        await lockEffectiveRequests(
          tx,
          catalog.episodes.map((item) => item.id),
        );
        await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
        await assertNumberingOwner(tx, actor.id);
        const preview = buildNumberingPreview(
          catalog,
          group,
          input.interpretation,
        );
        const pairs = preview.mappings.map((item) => ({
          episodeId: item.episodeId,
          expectedVersion: item.expectedVersion,
          absoluteNumber: item.absoluteNumber,
        }));
        if (
          preview.previewDigest !== input.previewDigest ||
          preview.groupDigest !== input.groupDigest ||
          preview.catalogDigest !== input.catalogDigest ||
          preview.numberingDigest !== input.numberingDigest ||
          snapshotHash(pairs) !== snapshotHash(input.mappings)
        )
          throw new MediaError(
            "numbering_preview_changed",
            "Catalog, group or numbering changed; review a fresh preview",
            409,
          );
        const required = preview.mappings
          .filter((item) => item.requiresOverride)
          .map((item) => item.episodeId)
          .sort();
        if (
          snapshotHash(required) !==
          snapshotHash([...input.overrideEpisodeIds].sort())
        )
          throw new MediaError(
            "numbering_override_required",
            "Explicitly confirm every existing mapping replaced by this batch",
            409,
          );
        const assigned = new Map(
          preview.mappings.map((item) => [item.episodeId, item.absoluteNumber]),
        );
        const numbers = catalog.episodes.flatMap((item) => {
          const number = assigned.get(item.id) ?? item.absoluteNumber;
          return number === null ? [] : [number];
        });
        if (new Set(numbers).size !== numbers.length)
          throw new MediaError(
            "numbering_conflict",
            "An absolute number conflicts with another episode, including outside this batch",
            409,
          );
        for (const mapping of preview.mappings)
          await writeNumberingMapping(tx, {
            actorId: actor.id,
            episodeId: mapping.episodeId,
            absoluteNumber: mapping.absoluteNumber,
            provenance: mapping.provenance,
            evidence: `TMDB group ${group.id}; subgroup ${input.interpretation.subgroupId}; reviewed start ${String(input.interpretation.firstAbsoluteNumber)}`,
          });
        const series = await tx.mediaItem.update({
          where: { id: seriesId },
          data: { version: { increment: 1 } },
        });
        return { status: "completed", version: series.version };
      },
    );
  }
}
