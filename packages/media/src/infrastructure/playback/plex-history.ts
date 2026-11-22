import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  PLEX_HISTORICAL_VIEW_PAGE_SIZE,
  PlexHistoricalViewsSchema,
  type PlexHistoricalViewImport,
  type PlexHistoricalViewQuery,
  type PlexHistoricalViews,
} from "#shared/household/plex-history.ts";
import { requireCurrentPlaybackOwner } from "./imports.ts";

export async function importPlexHistoricalViews(
  db: Database,
  actor: MediaActor,
  serverMachineId: string,
  input: PlexHistoricalViewImport,
) {
  requireOwner(actor);
  if (input.serverMachineId !== serverMachineId)
    throw new MediaError(
      "wrong_server",
      "History belongs to another Plex server",
      409,
    );
  const records = input.rows.map((row) => {
    const viewedAt = new Date(row.viewedAt);
    const originallyAvailableAt =
      row.originallyAvailableAt === null
        ? null
        : new Date(row.originallyAvailableAt);
    return {
      ...row,
      serverMachineId,
      sourceViewId: BigInt(row.sourceViewId),
      viewedAt,
      originallyAvailableAt,
      sourceSnapshotDigest: snapshotHash({
        ...row,
        viewedAt: viewedAt.toISOString(),
        originallyAvailableAt: originallyAvailableAt?.toISOString() ?? null,
      }),
    };
  });
  records.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      Number(left.sourceViewId - right.sourceViewId),
  );
  const candidateDigests = new Map(
    records.map((row) => [
      `${row.source}:${String(row.sourceViewId)}`,
      row.sourceSnapshotDigest,
    ]),
  );
  if (records.length !== candidateDigests.size)
    throw new MediaError(
      "duplicate_view",
      "The import contains repeated Plex view IDs",
      422,
    );

  return db.$transaction(async (tx) => {
    await requireCurrentPlaybackOwner(tx, actor);
    const identities = await tx.plexIdentityMapping.findMany({
      where: {
        serverMachineId,
        serverAccountId: {
          in: [...new Set(records.map((row) => row.serverAccountId))],
        },
        verifiedAt: { not: null },
      },
      select: {
        serverAccountId: true,
        user: { select: { plexAccountId: true } },
      },
    });
    const accounts = new Map(
      identities.map((identity) => [
        identity.serverAccountId,
        identity.user.plexAccountId,
      ]),
    );
    const inserted = await tx.plexHistoricalView.createMany({
      data: records.map((row) => ({
        ...row,
        boundPlexAccountId: accounts.get(row.serverAccountId) ?? null,
      })),
      skipDuplicates: true,
    });
    // Compare after the insert so concurrently imported keys get the same
    // immutable replay check. A conflict also rolls back the new rows.
    const persisted = await tx.plexHistoricalView.findMany({
      where: {
        serverMachineId,
        OR: [
          {
            source: "view",
            sourceViewId: {
              in: records
                .filter((row) => row.source === "view")
                .map((row) => row.sourceViewId),
            },
          },
          {
            source: "last_watched",
            sourceViewId: {
              in: records
                .filter((row) => row.source === "last_watched")
                .map((row) => row.sourceViewId),
            },
          },
        ],
      },
      select: {
        source: true,
        sourceViewId: true,
        sourceSnapshotDigest: true,
        serverAccountId: true,
        boundPlexAccountId: true,
      },
    });
    if (
      persisted.length !== records.length ||
      persisted.some(
        (row) =>
          candidateDigests.get(`${row.source}:${String(row.sourceViewId)}`) !==
          row.sourceSnapshotDigest,
      )
    )
      throw new MediaError(
        "history_changed",
        "A previously imported Plex view changed",
        409,
      );
    // Replaying the same source can bind an unclaimed row after its person
    // verifies their identity. A reassignment never transfers prior history.
    const unboundByAccount = new Map<
      string,
      { source: string; sourceViewId: bigint }[]
    >();
    for (const row of persisted) {
      const account = accounts.get(row.serverAccountId);
      if (account === undefined || row.boundPlexAccountId !== null) continue;
      const pending = unboundByAccount.get(account) ?? [];
      pending.push({ source: row.source, sourceViewId: row.sourceViewId });
      unboundByAccount.set(account, pending);
    }
    for (const [boundPlexAccountId, keys] of unboundByAccount) {
      await tx.plexHistoricalView.updateMany({
        where: { serverMachineId, boundPlexAccountId: null, OR: keys },
        data: { boundPlexAccountId },
      });
    }
    return {
      imported: inserted.count,
      unchanged: records.length - inserted.count,
    };
  });
}

export async function listPlexHistoricalViews(
  db: Database,
  actor: MediaActor,
  serverMachineId: string,
  query: PlexHistoricalViewQuery,
): Promise<PlexHistoricalViews> {
  return db.$transaction(
    async (tx) => {
      const user = await tx.mediaUser.findUnique({
        where: { id: actor.id },
        select: {
          plexAccountId: true,
          restricted: true,
          plexIdentity: {
            select: {
              serverMachineId: true,
              serverAccountId: true,
              plexRestricted: true,
              verifiedAt: true,
            },
          },
        },
      });
      if (user?.plexAccountId !== actor.plexAccountId)
        throw new MediaError(
          "unauthorized",
          "This account is no longer available",
          401,
        );
      const identity = user.plexIdentity;
      if (
        identity === null ||
        user.restricted ||
        identity.plexRestricted ||
        identity.verifiedAt === null ||
        identity.serverMachineId !== serverMachineId ||
        identity.serverAccountId === null
      )
        return { items: [], nextCursor: null };

      const scope = {
        serverMachineId,
        serverAccountId: identity.serverAccountId,
        boundPlexAccountId: user.plexAccountId,
      };
      let where: Prisma.PlexHistoricalViewWhereInput = scope;
      if (query.cursor !== undefined) {
        const anchor = await tx.plexHistoricalView.findFirst({
          where: {
            ...scope,
            source: query.cursor.source,
            sourceViewId: BigInt(query.cursor.sourceViewId),
          },
          select: { source: true, sourceViewId: true, viewedAt: true },
        });
        if (anchor === null)
          throw new MediaError(
            "invalid_cursor",
            "This history page has expired",
            400,
          );
        where = {
          ...scope,
          OR: [
            { viewedAt: { lt: anchor.viewedAt } },
            { viewedAt: anchor.viewedAt, source: { lt: anchor.source } },
            {
              viewedAt: anchor.viewedAt,
              source: anchor.source,
              sourceViewId: { lt: anchor.sourceViewId },
            },
          ],
        };
      }
      const rows = await tx.plexHistoricalView.findMany({
        where,
        select: {
          source: true,
          sourceViewId: true,
          kind: true,
          title: true,
          seriesTitle: true,
          seasonNumber: true,
          episodeNumber: true,
          viewedAt: true,
        },
        orderBy: [
          { viewedAt: "desc" },
          { source: "desc" },
          { sourceViewId: "desc" },
        ],
        take: PLEX_HISTORICAL_VIEW_PAGE_SIZE + 1,
      });
      const page = rows.slice(0, PLEX_HISTORICAL_VIEW_PAGE_SIZE);
      const last = page.at(-1);
      return PlexHistoricalViewsSchema.parse({
        items: page.map((row) => ({
          ...row,
          sourceViewId: Number(row.sourceViewId),
          viewedAt: row.viewedAt.toISOString(),
        })),
        nextCursor:
          last !== undefined && rows.length > page.length
            ? `${last.source}:${String(last.sourceViewId)}`
            : null,
      });
    },
    { isolationLevel: "RepeatableRead" },
  );
}
