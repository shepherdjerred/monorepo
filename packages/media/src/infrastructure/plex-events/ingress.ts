import type { Database } from "#infrastructure/database.ts";
import { Prisma } from "#generated/prisma/client.ts";
import {
  captureWatchBindingScope,
  readWatchBinding,
} from "#automation/plex-events/binding.ts";
import { lockMovieChoiceIdentities } from "#infrastructure/movie-editions/access.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
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

async function captureHintTarget(
  tx: Prisma.TransactionClient,
  hint: PlexWatchHint,
) {
  const claims = await tx.plexItemClaim.findMany({
    where: {
      serverMachineId: hint.serverMachineId,
      sectionId: hint.sectionId,
      ratingKey: hint.ratingKey,
      edition: "default",
    },
    select: { mediaId: true },
    take: 2,
  });
  if (claims.length > 1) return null;
  // Legacy display identity discovers only a quarantined candidate; its exact
  // immutable receipt must establish authority below before an operation exists.
  const matches =
    claims.length === 1
      ? claims.map((claim) => ({ id: claim.mediaId }))
      : await tx.mediaItem.findMany({
          where: {
            kind: hint.mediaKind,
            availability: "quarantined",
            AND: [
              {
                externalIds: {
                  path: ["plexSectionId"],
                  equals: hint.sectionId,
                },
              },
              {
                externalIds: {
                  path: ["plexRatingKey"],
                  equals: hint.ratingKey,
                },
              },
            ],
          },
          select: { id: true },
          take: 2,
        });
  const match = matches[0];
  if (match === undefined || matches.length !== 1) return null;
  const access = {
    serverMachineId: hint.serverMachineId,
    sectionId: hint.sectionId,
    sectionType:
      hint.mediaKind === "movie" ? ("movie" as const) : ("show" as const),
  };
  const scope = await captureWatchBindingScope(tx, match.id, access);
  if (scope === null || (claims.length === 0 && scope.quarantine === null))
    return null;
  const original = await readWatchBinding(tx, scope);
  return original?.association.item.ratingKey !== hint.ratingKey ||
    original.association.item.type !== hint.mediaKind
    ? null
    : { match, scope, original };
}

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
      const captured = await captureHintTarget(tx, hint);
      if (captured === null) return;
      const { match, scope, original } = captured;
      await lockCanonicalMedia(tx, scope.mediaIds);
      await lockExistingDefaultTargets(tx, scope.mediaIds);
      await lockEffectiveRequests(tx, scope.mediaIds);
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      await lockMovieChoiceIdentities(tx, { mediaIds: scope.mediaIds });
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(scope.assetIds)}) ORDER BY id FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(scope.assetIds)}) ORDER BY "assetId","mediaId" FOR SHARE`,
      );
      const continuationIds = scope.quarantine?.continuationIds ?? [];
      if (continuationIds.length > 0)
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "NativeQuarantineContinuation" WHERE id IN (${Prisma.join(continuationIds)}) ORDER BY id FOR UPDATE`,
        );
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
      const current = await readWatchBinding(tx, scope);
      if (
        current === null ||
        media.kind !== hint.mediaKind ||
        identityHash(current.authority) !== identityHash(original.authority) ||
        current.association.item.ratingKey !== hint.ratingKey
      )
        return;
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
