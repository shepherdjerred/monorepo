import type { Database } from "#infrastructure/database.ts";
import {
  lockCanonicalMedia,
  lockExistingDefaultTargets,
  canonicalRootId,
} from "#infrastructure/editions/locks.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  PlexWatchHintSchema,
  ObservePlexHintInputSchema,
  type PlexWatchHint,
} from "#shared/plex-events/contract.ts";

export class PrismaPlexEventIngress {
  constructor(
    private readonly db: Database,
    private readonly configuration: {
      serverMachineId: string;
      permittedSections: () => Promise<{ movie: string; series: string }>;
    },
  ) {}

  async accept(raw: PlexWatchHint): Promise<void> {
    const hint = PlexWatchHintSchema.parse(raw);
    const sections = await this.configuration.permittedSections();
    const section =
      hint.mediaKind === "movie" ? sections.movie : sections.series;
    if (
      hint.serverMachineId !== this.configuration.serverMachineId ||
      hint.sectionId !== section
    )
      return;
    const bucket = Math.floor(Date.now() / 30_000);
    await serializable(this.db, async (tx) => {
      const matches = await tx.mediaItem.findMany({
        where: {
          kind: hint.mediaKind,
          AND: [
            {
              externalIds: { path: ["plexSectionId"], equals: hint.sectionId },
            },
            {
              externalIds: { path: ["plexRatingKey"], equals: hint.ratingKey },
            },
          ],
        },
        select: { id: true },
        take: 2,
      });
      const match = matches[0];
      if (match === undefined || matches.length !== 1) return;
      await lockCanonicalMedia(tx, [match.id]);
      await lockExistingDefaultTargets(tx, [match.id]);
      await lockEffectiveRequests(tx, [match.id]);
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const media = await tx.mediaItem.findUniqueOrThrow({
        where: { id: match.id },
        include: {
          parent: { include: { parent: true } },
          intents: { where: { edition: "default" } },
        },
      });
      const target = media.intents[0];
      const root = canonicalRootId(media);
      if (
        target === undefined ||
        root === null ||
        target.editionRootId !== root ||
        target.automationEpoch !== runtime.recoveryEpoch
      )
        return;
      // Recheck the exact external mapping after acquiring canonical locks.
      const current = await tx.mediaItem.count({
        where: {
          id: match.id,
          kind: hint.mediaKind,
          AND: [
            {
              externalIds: { path: ["plexSectionId"], equals: hint.sectionId },
            },
            {
              externalIds: { path: ["plexRatingKey"], equals: hint.ratingKey },
            },
          ],
        },
      });
      if (current !== 1) return;
      const payload = {
        schemaVersion: 1,
        edition: "default",
        mediaId: media.id,
        generation: target.generation,
        serverMachineId: hint.serverMachineId,
        sectionId: hint.sectionId,
        ratingKey: hint.ratingKey,
      };
      const key = `plex-hint:${snapshotHash({ ...payload, recoveryEpoch: runtime.recoveryEpoch, bucket })}`;
      const operationId = await queueOperation(tx, {
        key,
        kind: "observe_plex_hint",
        targetId: media.id,
        payload,
      });
      const operation = await tx.operation.findUniqueOrThrow({
        where: { id: operationId },
      });
      ObservePlexHintInputSchema.parse(operation.payload);
    });
  }
}
