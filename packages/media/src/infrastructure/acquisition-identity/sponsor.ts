import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { authorizeRequester } from "#infrastructure/requester-authorization.ts";
import type { AcquisitionIdentitySnapshot } from "#shared/acquisition/identity.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";

export async function captureSponsorAuthority(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string;
    sponsorRequestId: string;
    mediaIds: string[];
    serverMachineId?: string;
  },
) {
  if (input.serverMachineId === undefined)
    throw new MediaError(
      "plex_scope_unconfigured",
      "Plex authorization is not configured",
      503,
    );
  const sponsor = await tx.mediaRequest.findUniqueOrThrow({
    where: { id: input.sponsorRequestId },
  });
  const mapping = await tx.plexIdentityMapping.findUnique({
    where: { userId: sponsor.userId },
  });
  const actorId =
    mapping?.kind === "managed"
      ? await managedSponsorActor(tx, sponsor)
      : sponsor.userId;
  if (actorId === null)
    throw new MediaError(
      "plex_library_access_required",
      "Managed acquisition requires an authorized owner coordinator",
      403,
    );
  const authority = {
    userId: sponsor.userId,
    actorId,
    serverMachineId: input.serverMachineId,
  };
  await assertSponsorAuthority(tx, {
    authority,
    sponsorRequestId: sponsor.id,
    operationId: input.operationId,
    mediaIds: input.mediaIds,
  });
  return authority;
}

async function managedSponsorActor(
  tx: Prisma.TransactionClient,
  request: { id: string; userId: string; sponsorRequestId: string | null },
): Promise<string | null> {
  const sources = await tx.requestCoverage.findMany({
    where: {
      edition: "default",
      requestId: request.id,
      active: true,
      rootRequest: { ...effectiveRequestWhere },
    },
    select: { rootRequestId: true },
    take: 101,
  });
  if (sources.length > 100)
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Managed request provenance exceeds the bounded scope",
      409,
    );
  const ids = [
    request.id,
    ...sources.map((row) => row.rootRequestId),
    ...(request.sponsorRequestId === null ? [] : [request.sponsorRequestId]),
  ];
  const roots = await tx.mediaRequest.findMany({
    where: {
      id: { in: ids },
      userId: request.userId,
      direct: true,
      ...effectiveRequestWhere,
    },
  });
  if (roots.length === 0) return null;
  const operations = await tx.operation.findMany({
    where: {
      kind: { in: ["reconcile_media", "restore_media", "expand_request"] },
      userId: { not: null },
      OR: roots.map((root) => ({
        targetId: root.mediaId,
        AND: [
          { payload: { path: ["requestId"], equals: root.id } },
          { payload: { path: ["requestVersion"], equals: root.version } },
        ],
      })),
    },
    take: 101,
  });
  if (operations.length > 100)
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Managed request provenance exceeds the bounded scope",
      409,
    );
  const actors = [
    ...new Set(
      operations.flatMap((operation) =>
        operation.userId === null ? [] : [operation.userId],
      ),
    ),
  ];
  return actors.length === 1 ? (actors[0] ?? null) : null;
}

export async function assertLegacySubmissionSponsor(
  tx: Prisma.TransactionClient,
  attempt: {
    identityEvidence: unknown;
    sponsorRequestId: string | null;
    operationId: string;
    mediaIds: string[];
  },
  serverMachineId?: string,
) {
  if (attempt.identityEvidence !== null) return;
  if (attempt.sponsorRequestId === null)
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Historical acquisition has no provable requester authority",
      409,
    );
  await captureSponsorAuthority(tx, {
    operationId: attempt.operationId,
    sponsorRequestId: attempt.sponsorRequestId,
    mediaIds: attempt.mediaIds,
    ...(serverMachineId === undefined ? {} : { serverMachineId }),
  });
}

export async function assertSponsorAuthority(
  tx: Prisma.TransactionClient,
  input: {
    authority: AcquisitionIdentitySnapshot["sponsorAuthority"];
    sponsorRequestId: string;
    operationId: string;
    mediaIds: string[];
  },
) {
  const operation = await tx.operation.findUnique({
    where: { id: input.operationId },
  });
  if (operation === null)
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Acquisition coordinator provenance is missing",
      409,
    );
  const userIds = [
    ...new Set([
      input.authority.actorId,
      input.authority.userId,
      ...(operation.userId === null ? [] : [operation.userId]),
    ]),
  ].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR SHARE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(userIds)}) ORDER BY "userId" FOR SHARE`,
  );
  const sponsor = await tx.mediaRequest.findFirst({
    where: {
      id: input.sponsorRequestId,
      userId: input.authority.userId,
      ...effectiveRequestWhere,
    },
  });
  if (sponsor === null)
    throw new MediaError(
      "acquisition_sponsor_changed",
      "The acquisition sponsor no longer has an effective claim",
      409,
    );
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: input.authority.actorId },
  });
  if (
    actor.id !== input.authority.userId &&
    (await managedSponsorActor(tx, sponsor)) !== actor.id
  )
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Managed requester authority changed",
      409,
    );
  const owner =
    operation.kind === "acquire_release" && operation.userId !== null
      ? await tx.mediaUser.findUniqueOrThrow({
          where: { id: operation.userId },
        })
      : null;
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: input.mediaIds } },
  });
  if (rows.length !== input.mediaIds.length)
    throw new Error("Sponsor coverage is incomplete");
  for (const media of rows) {
    const ids = z
      .object({ plexSectionId: z.string().min(1).optional() })
      .parse(media.externalIds);
    const settings = {
      kind: media.kind,
      serverMachineId: input.authority.serverMachineId,
      ...(ids.plexSectionId === undefined
        ? {}
        : { sectionId: ids.plexSectionId }),
    };
    await authorizeRequester(tx, actor, input.authority.userId, settings);
    if (owner !== null)
      requireOwner(await authorizeRequester(tx, owner, owner.id, settings));
  }
}
