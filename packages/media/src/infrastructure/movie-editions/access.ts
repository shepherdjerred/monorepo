import { Prisma, type PlexIdentityMapping } from "#generated/prisma/client.ts";
import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import type { MovieEditionChoiceAudit } from "#shared/movie-editions/authority.ts";
import { movieChoiceFreshness } from "./freshness.ts";

export type MovieChoiceAccess = {
  serverMachineId: string;
  movieSectionId: string;
};
export type MovieProtectionAccess = Pick<MovieChoiceAccess, "serverMachineId">;

export function requireMovieProtectionAccess(input: {
  serverMachineId?: string | undefined;
}): MovieProtectionAccess {
  if (input.serverMachineId === undefined || input.serverMachineId === "")
    throw new MediaError(
      "plex_scope_unconfigured",
      "Plex server identity is not configured",
      503,
    );
  return { serverMachineId: input.serverMachineId };
}

export function movieSourceSection(externalIds: unknown): string | undefined {
  return z
    .object({ plexSectionId: z.string().min(1).optional() })
    .parse(externalIds).plexSectionId;
}

/** Lock the complete identity cohort once before per-request projections or delivery locks. */
export async function lockMovieChoiceIdentities(
  tx: Prisma.TransactionClient,
  input: {
    mediaIds: readonly string[];
    extraUserIds?: readonly string[];
  },
): Promise<void> {
  const requests = await tx.mediaRequest.findMany({
    where: {
      mediaId: { in: [...input.mediaIds] },
      active: true,
      excluded: false,
    },
    select: {
      userId: true,
      movieEditionChoice: { select: { actorId: true, subjectUserId: true } },
    },
  });
  const ids = [
    ...new Set([
      ...(input.extraUserIds ?? []),
      ...requests.flatMap((row) => [
        row.userId,
        ...(row.movieEditionChoice === null
          ? []
          : [
              row.movieEditionChoice.actorId,
              row.movieEditionChoice.subjectUserId,
            ]),
      ]),
    ]),
  ].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(ids)}) ORDER BY "userId" FOR SHARE`,
  );
}

export function requireMovieChoiceAccess(input: {
  serverMachineId?: string | undefined;
  movieSectionId?: string | undefined;
}): MovieChoiceAccess {
  if (
    input.serverMachineId === undefined ||
    input.serverMachineId === "" ||
    input.movieSectionId === undefined ||
    input.movieSectionId === ""
  )
    throw new MediaError(
      "plex_scope_unconfigured",
      "Movie library authorization is not configured",
      503,
    );
  return {
    serverMachineId: input.serverMachineId,
    movieSectionId: input.movieSectionId,
  };
}

/** Acquire identities after the caller's full canonical/target/claim/runtime locks. */
export async function movieChoiceSubject(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    subjectUserId: string;
    mediaSectionId?: string | undefined;
  } & (
    | { purpose: "choose"; access: MovieChoiceAccess }
    | { purpose: "protect"; access: MovieProtectionAccess }
  ),
) {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const ids = [...new Set([input.actorId, input.subjectUserId])].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(ids)}) ORDER BY "userId" FOR SHARE`,
  );
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: input.actorId },
  });
  const subject = await tx.mediaUser.findUniqueOrThrow({
    where: { id: input.subjectUserId },
  });
  const managed = actor.id !== subject.id;
  if (managed && actor.role !== "owner")
    throw new MediaError(
      "owner_required",
      "Only the owner may act for a managed Home profile",
      403,
    );
  // Self cancellation remains possible after library revocation. Managed identity must still be current.
  const mapping = await tx.plexIdentityMapping.findUnique({
    where: { userId: subject.id },
  });
  if (managed || input.purpose === "choose") {
    if (actor.restricted || subject.restricted)
      throw new MediaError(
        "requests_restricted",
        "This profile cannot authorize movie requests",
        403,
      );
    assertCurrentMapping(mapping, managed, input.access);
  }
  if (
    input.purpose === "choose" &&
    (mapping === null ||
      (!managed && (mapping.plexRestricted || mapping.kind !== "account")) ||
      !mapping.permittedMediaKinds.includes("movie") ||
      !mapping.permittedSectionIds.includes(input.access.movieSectionId) ||
      (input.mediaSectionId !== undefined &&
        !mapping.permittedSectionIds.includes(input.mediaSectionId)))
  )
    throw new MediaError(
      "plex_library_access_required",
      "Movie library permission is required",
      403,
    );
  const freshness =
    managed || input.purpose === "choose"
      ? movieChoiceFreshness(requiredVerification(mapping), observed)
      : null;
  return { actor, subject, mapping, freshness };
}

function assertCurrentMapping(
  mapping: PlexIdentityMapping | null,
  managed: boolean,
  access: MovieProtectionAccess,
) {
  const now = Date.now();
  if (
    mapping?.serverMachineId !== access.serverMachineId ||
    mapping.verifiedAt === null ||
    mapping.verifiedAt.getTime() > now ||
    now - mapping.verifiedAt.getTime() > 300_000 ||
    (managed && (mapping.kind !== "managed" || mapping.homeUserId === null))
  )
    throw new MediaError(
      "plex_library_access_required",
      "Refresh the exact Plex profile identity",
      403,
    );
}

function requiredVerification(
  mapping: { verifiedAt: Date | null } | null,
): Date {
  const verifiedAt = mapping?.verifiedAt;
  if (verifiedAt === undefined || verifiedAt === null)
    throw new Error("Authorized movie identity lacks its verification time");
  return verifiedAt;
}

export function movieChoiceAudit(
  input: Awaited<ReturnType<typeof movieChoiceSubject>>,
  access: MovieChoiceAccess,
): MovieEditionChoiceAudit {
  if (input.mapping === null)
    throw new Error("A new movie choice requires a verified identity mapping");
  return {
    schemaVersion: 1,
    mode: input.actor.id === input.subject.id ? "self" : "managed_owner",
    actorVersion: input.actor.version,
    subjectVersion: input.subject.version,
    mappingVersion: input.mapping.version,
    serverMachineId: access.serverMachineId,
    homeUserId: input.mapping.homeUserId,
    serverAccountId: input.mapping.serverAccountId,
  };
}
