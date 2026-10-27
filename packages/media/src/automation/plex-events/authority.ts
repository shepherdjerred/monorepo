import { z } from "zod";
import { Prisma, type MediaKind } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  canonicalRootId,
  lockCanonicalMedia,
  lockExistingDefaultTargets,
} from "#infrastructure/editions/locks.ts";
import { MediaError } from "#application/errors.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import {
  effectiveRequestWhere,
  lockEffectiveRequests,
} from "#infrastructure/request-claims.ts";
import {
  ObservePlexHintInputSchema,
  ObserveMoviePlexHintV4Schema,
  type ObserveWatchHint,
} from "#shared/plex-events/contract.ts";
import { watchAwait, type WatchExecution } from "./execution.ts";
import { compensationPlayback } from "#infrastructure/native-compensation/playback.ts";
import {
  captureWatchBindingScope,
  readWatchBinding,
  type WatchBindingScope,
} from "./binding.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";

export const PlexIdentitySchema = z.object({
  plexRatingKey: z.string().regex(/^\d+$/u).optional(),
  plexSectionId: z.string().optional(),
});
export type WatchObservationOptions = {
  expectedHint?: ObserveWatchHint;
  edition?: MovieEditionKey;
};
export type WatchScope = WatchObservationOptions & {
  mediaId: string;
  serverMachineId: string;
  sections: { movie: string; series: string };
  bindingScope: WatchBindingScope | null;
};

function hintTargetMatches(
  scope: WatchScope,
  target: {
    sectionId: string | undefined;
    kind: MediaKind;
    targetEpoch: number;
    runtimeEpoch: number;
  },
) {
  if (scope.expectedHint === undefined) return true;
  return (
    target.sectionId ===
      (target.kind === "movie"
        ? scope.sections.movie
        : scope.sections.series) && target.targetEpoch === target.runtimeEpoch
  );
}

export async function watchScope(
  context: MediaAutomationContext,
  mediaId: string,
  options: WatchObservationOptions,
  execution: WatchExecution,
): Promise<WatchScope> {
  if (context.serverMachineId === undefined)
    throw new Error("Watch observer server identity is unconfigured");
  const media = await watchAwait(
    execution,
    context.db.mediaItem.findUniqueOrThrow({
      where: { id: mediaId },
      select: { kind: true },
    }),
  );
  const edition = options.edition ?? "default";
  if (edition !== "default" && media.kind !== "movie")
    throw new MediaError(
      "movie_scope_required",
      "Named cuts require a movie",
      422,
    );
  if (edition !== "default" && options.expectedHint?.schemaVersion === 1)
    throw new Error("An unscoped Plex hint cannot identify a named movie cut");
  if (
    options.expectedHint?.schemaVersion === 4 &&
    (options.expectedHint.scope.edition !== edition ||
      options.expectedHint.scope.mediaId !== mediaId)
  )
    throw new Error("Movie watch observation differs from its hint scope");
  const access = await watchAwait(
    execution,
    context.plexAccess(media.kind === "movie" ? "movie" : "show"),
  );
  const bindingScope = await watchAwait(
    execution,
    captureWatchBindingScope(context.db, mediaId, access, edition),
  );
  const sections = {
    movie: access.sectionType === "movie" ? access.sectionId : "",
    series: access.sectionType === "show" ? access.sectionId : "",
  };
  return {
    mediaId,
    serverMachineId: context.serverMachineId,
    sections,
    bindingScope,
    ...options,
  };
}

export async function lockWatchAuthority(
  tx: Prisma.TransactionClient,
  scope: WatchScope,
  execution: WatchExecution,
) {
  const initial = await watchAwait(
    execution,
    tx.mediaItem.findUnique({ where: { id: scope.mediaId } }),
  );
  if (initial === null) return null;
  if (scope.bindingScope === null) return null;
  const mediaIds = scope.bindingScope.mediaIds;
  const edition = scope.edition ?? "default";
  await watchAwait(execution, lockCanonicalMedia(tx, mediaIds));
  await watchAwait(execution, lockWatchTargets(tx, mediaIds, edition));
  const target = await watchAwait(
    execution,
    tx.mediaIntent.findUnique({
      where: { mediaId_edition: { mediaId: scope.mediaId, edition } },
    }),
  );
  if (target?.editionRootId == null) return null;
  await watchAwait(execution, lockWatchRequests(tx, mediaIds, edition));
  await watchAwait(
    execution,
    tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR SHARE`,
  );
  const runtime = await watchAwait(
    execution,
    tx.mediaRuntimeState.findUniqueOrThrow({ where: { id: "singleton" } }),
  );
  if (
    !(await watchAwait(
      execution,
      lockRuntimeAuthority(tx, runtime.recoveryEpoch),
    ))
  )
    return null;
  const media = await watchAwait(
    execution,
    tx.mediaItem.findUniqueOrThrow({
      where: { id: scope.mediaId },
      include: { parent: { include: { parent: true } } },
    }),
  );
  if (canonicalRootId(media) !== target.editionRootId) return null;
  if (media.kind !== "movie" && media.kind !== "episode") return null;
  const compensation = await watchAwait(
    execution,
    compensationPlayback(tx, {
      mediaId: media.id,
      recoveryEpoch: runtime.recoveryEpoch,
      serverMachineId: scope.serverMachineId,
      externalIds: media.externalIds,
    }),
  );
  if (compensation.state === "protected") return null;
  const requestWhere = watchRequests(edition);
  const claims = await watchAwait(
    execution,
    tx.mediaRequest.findMany({
      where: { mediaId: scope.mediaId, ...requestWhere },
      orderBy: { id: "asc" },
      include: {
        coverageSources: {
          orderBy: { rootRequestId: "asc" },
          include: { rootRequest: true },
        },
      },
    }),
  );
  const cohortClaims = await watchAwait(
    execution,
    tx.mediaRequest.findMany({
      where: {
        mediaId: { in: mediaIds },
        ...requestWhere,
      },
      select: { userId: true },
    }),
  );
  const ids = [...new Set(cohortClaims.map((claim) => claim.userId))].sort();
  if (ids.length > 0) {
    await watchAwait(
      execution,
      tx.$queryRaw(
        Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
      ),
    );
    await watchAwait(
      execution,
      tx.$queryRaw(
        Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(ids)}) ORDER BY "userId" FOR SHARE`,
      ),
    );
    await watchAwait(
      execution,
      tx.$queryRaw(
        Prisma.sql`SELECT id FROM "Credential" WHERE "userId" IN (${Prisma.join(ids)}) AND kind='plex' ORDER BY "userId",id FOR SHARE`,
      ),
    );
  }
  const users = await watchAwait(
    execution,
    tx.mediaUser.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
      include: { plexIdentity: true, credentials: { where: { kind: "plex" } } },
    }),
  );
  if (users.length !== ids.length)
    throw new Error("Watch requester disappeared");
  const selectedUsers = new Set(claims.map((claim) => claim.userId));
  const participants = users.filter(
    (user) => user.role !== "owner" && selectedUsers.has(user.id),
  );
  const assets = scope.bindingScope.assetIds;
  await watchAwait(
    execution,
    tx.$queryRaw(
      Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(assets)}) ORDER BY id FOR UPDATE`,
    ),
  );
  await watchAwait(
    execution,
    tx.$queryRaw(
      Prisma.sql`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(assets)}) ORDER BY "assetId","mediaId" FOR SHARE`,
    ),
  );
  const continuations = scope.bindingScope.quarantine?.continuationIds ?? [];
  if (continuations.length > 0)
    await watchAwait(
      execution,
      tx.$queryRaw(
        Prisma.sql`SELECT id FROM "NativeQuarantineContinuation" WHERE id IN (${Prisma.join(continuations)}) ORDER BY id FOR UPDATE`,
      ),
    );
  const binding = await watchAwait(
    execution,
    readWatchBinding(tx, scope.bindingScope),
  );
  const identity: z.infer<typeof PlexIdentitySchema> =
    binding === null
      ? {}
      : {
          plexRatingKey: binding.association.item.ratingKey,
          plexSectionId: binding.association.access.sectionId,
        };
  const hintCurrent =
    hintTargetMatches(scope, {
      sectionId: identity.plexSectionId,
      kind: media.kind,
      targetEpoch: target.automationEpoch,
      runtimeEpoch: runtime.recoveryEpoch,
    }) &&
    (await validHint(
      tx,
      scope,
      { identity, epoch: runtime.recoveryEpoch, generation: target.generation },
      execution,
    ));
  const signature = JSON.stringify({
    mediaId: media.id,
    ...(edition === "default" ? {} : { edition }),
    kind: media.kind,
    ...(compensation.state === "verified"
      ? { compensationPublicationHash: compensation.proofHash }
      : {}),
    serverMachineId: scope.serverMachineId,
    sections: scope.sections,
    epoch: runtime.recoveryEpoch,
    generation: target.generation,
    automationEpoch: target.automationEpoch,
    claims: claims.map((claim) => ({
      id: claim.id,
      userId: claim.userId,
      version: claim.version,
      direct: claim.direct,
      active: claim.active,
      excluded: claim.excluded,
      sources: claim.coverageSources.map((source) => ({
        rootRequestId: source.rootRequestId,
        active: source.active,
        sourceVersion: source.sourceVersion,
        rootVersion: source.rootRequest.version,
        rootActive: source.rootRequest.active,
        rootExcluded: source.rootRequest.excluded,
        rootDirect: source.rootRequest.direct,
      })),
    })),
    users: users.map((user) => ({
      id: user.id,
      plexAccountId: user.plexAccountId,
      role: user.role,
      restricted: user.restricted,
      mapping: user.plexIdentity,
      credentials: user.credentials.map((credential) => ({
        id: credential.id,
        ciphertext: credential.ciphertext,
      })),
    })),
  });
  return {
    media,
    target,
    runtime,
    identity,
    participants,
    signature,
    binding,
    scope,
    hintCurrent,
  };
}

async function lockWatchTargets(
  tx: Prisma.TransactionClient,
  mediaIds: string[],
  edition: MovieEditionKey,
): Promise<void> {
  if (edition === "default") return lockExistingDefaultTargets(tx, mediaIds);
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId" FROM "MediaIntent" WHERE "mediaId" IN (${Prisma.join(mediaIds)}) AND edition=${edition} ORDER BY "mediaId" FOR UPDATE`,
  );
}

async function lockWatchRequests(
  tx: Prisma.TransactionClient,
  mediaIds: string[],
  edition: MovieEditionKey,
): Promise<void> {
  if (edition === "default") return lockEffectiveRequests(tx, mediaIds);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaRequest" WHERE "mediaId" IN (${Prisma.join(mediaIds)}) AND edition=${edition} ORDER BY id FOR SHARE`,
  );
}

function watchRequests(edition: MovieEditionKey) {
  return edition === "default"
    ? effectiveRequestWhere
    : { edition, active: true, excluded: false, direct: true };
}

async function validHint(
  tx: Prisma.TransactionClient,
  scope: WatchScope,
  current: {
    identity: z.infer<typeof PlexIdentitySchema>;
    epoch: number;
    generation: number;
  },
  execution: WatchExecution,
) {
  const hint = scope.expectedHint;
  if (hint === undefined) return true;
  const operation = await watchAwait(
    execution,
    tx.operation.findUnique({ where: { id: hint.operationId } }),
  );
  const schema =
    hint.schemaVersion === 1
      ? ObservePlexHintInputSchema
      : ObserveMoviePlexHintV4Schema;
  const stored = schema.safeParse(operation?.payload);
  return (
    operation?.kind === hint.kind &&
    operation.targetId === scope.mediaId &&
    stored.success &&
    JSON.stringify(stored.data) === JSON.stringify(schema.parse(hint)) &&
    hint.recoveryEpoch === current.epoch &&
    hint.generation === current.generation &&
    hint.mediaId === scope.mediaId &&
    hint.serverMachineId === scope.serverMachineId &&
    hint.ratingKey === current.identity.plexRatingKey &&
    hint.sectionId === current.identity.plexSectionId
  );
}

export type WatchAuthority = NonNullable<
  Awaited<ReturnType<typeof lockWatchAuthority>>
>;
export type WatchParticipant = WatchAuthority["participants"][number];
