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
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  PlexWatchHintSchema,
  ObservePlexHintInputSchema,
  ObserveMoviePlexHintV4Schema,
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
    },
    select: { mediaId: true, edition: true },
    take: 2,
  });
  if (claims.length > 1) return null;
  // Legacy display identity discovers only a quarantined candidate; its exact
  // immutable receipt must establish authority below before an operation exists.
  let matches = claims.map((claim) => ({
    id: claim.mediaId,
    edition: MovieEditionKeySchema.parse(claim.edition),
  }));
  if (claims.length === 0) {
    const legacyMatches = await tx.mediaItem.findMany({
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
    matches = legacyMatches.map((media) => ({
      ...media,
      edition: "default" as const,
    }));
  }
  const match = matches[0];
  if (match === undefined || matches.length !== 1) return null;
  const access = {
    serverMachineId: hint.serverMachineId,
    sectionId: hint.sectionId,
    sectionType:
      hint.mediaKind === "movie" ? ("movie" as const) : ("show" as const),
  };
  if (match.edition !== "default" && hint.mediaKind !== "movie") return null;
  const scope = await captureWatchBindingScope(
    tx,
    match.id,
    access,
    match.edition,
  );
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
      if (match.edition === "default") {
        await lockCanonicalMedia(tx, scope.mediaIds);
        await lockExistingDefaultTargets(tx, scope.mediaIds);
        await lockEffectiveRequests(tx, scope.mediaIds);
      } else {
        await lockMovieCommand(tx, {
          rootMediaId: match.id,
          mediaId: match.id,
          edition: match.edition,
        });
      }
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
          intents: { where: { edition: match.edition } },
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
      const identity = {
        mediaId: media.id,
        generation: target.generation,
        serverMachineId: hint.serverMachineId,
        sectionId: hint.sectionId,
        ratingKey: hint.ratingKey,
      };
      const payload =
        match.edition === "default"
          ? { schemaVersion: 1, edition: "default", ...identity }
          : {
              schemaVersion: 4,
              scope: {
                rootMediaId: media.id,
                mediaId: media.id,
                edition: match.edition,
              },
              ...identity,
            };
      const key = `${match.edition === "default" ? "plex-hint" : "movie-plex-hint-v4"}:${snapshotHash({ ...payload, recoveryEpoch: runtime.recoveryEpoch, bucket })}`;
      const operationId = await queueOperation(tx, {
        key,
        kind:
          match.edition === "default"
            ? "observe_plex_hint"
            : "observe_movie_plex_hint_v4",
        targetId: media.id,
        payload,
      });
      const operation = await tx.operation.findUniqueOrThrow({
        where: { id: operationId },
      });
      if (match.edition === "default")
        ObservePlexHintInputSchema.parse(operation.payload);
      else ObserveMoviePlexHintV4Schema.parse(operation.payload);
    });
  }
}
