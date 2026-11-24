import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { repeatableRead } from "#infrastructure/locks.ts";
import {
  bindingIdentity,
  durableBindingIdentity,
  eligibleBindingTarget,
} from "#infrastructure/recovery/legacy-claims/bindings.ts";
import { personalSourceSelection } from "#infrastructure/recovery/legacy-claims/personal-accounting.ts";
import { assessVisibilityAccess } from "#infrastructure/visibility/access.ts";
import { catalogIdentity } from "#migration/catalog-targets.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import {
  PersonalMigrationClaimSchema,
  seerrRequestReferenceKey,
  type PersonalMigrationClaim,
} from "#shared/personal-migration/contract.ts";
import { ImportedRequestHistorySchema } from "#shared/personal-migration/history.ts";
import {
  captureHasUniquePlexRequester,
  isIndependentSeerrAccount,
} from "./seerr-attachment-binding.ts";

const HistoryReceipt = z.object({
  claims: z.array(PersonalMigrationClaimSchema).max(1000),
});
const MAX_OBSERVATIONS = 5000;

function historyLimit() {
  return new MediaError(
    "migration_limit",
    "Imported request history exceeds its bounded inventory",
    422,
  );
}

function reviewedObservations(receipts: readonly { payload: unknown }[]) {
  const observations = new Map<
    string,
    { claim: PersonalMigrationClaim; payload: unknown }
  >();
  for (const receipt of receipts) {
    for (const claim of HistoryReceipt.parse(receipt.payload).claims) {
      const key = seerrRequestReferenceKey(claim);
      if (observations.has(key)) continue;
      observations.set(key, { claim, payload: receipt.payload });
      if (observations.size > MAX_OBSERVATIONS) throw historyLimit();
    }
  }
  return observations;
}

async function latestObservations(tx: Prisma.TransactionClient) {
  const receipts = await tx.applicationEvent.findMany({
    where: { kind: "personal_state_imported" },
    select: { payload: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1001,
  });
  if (receipts.length > 1000) throw historyLimit();

  const observations = reviewedObservations(receipts);
  if (observations.size === 0) return [];

  // Only compare source IDs that were actually reviewed. If never reviewed,
  // an omitted source record cannot create or override a historical entry.
  const byCapture = new Map<string, string[]>();
  for (const { claim } of observations.values()) {
    const keys = byCapture.get(claim.captureId) ?? [];
    keys.push(claim.provenanceKey);
    byCapture.set(claim.captureId, keys);
  }
  const records = await tx.migrationRecord.findMany({
    where: {
      kind: "request",
      OR: [...byCapture].map(([captureId, keys]) => ({
        captureId,
        provenanceKey: { in: keys },
      })),
    },
    include: {
      capture: {
        select: {
          completedAt: true,
          manifestHash: true,
          sourceKind: true,
          sourceInstanceId: true,
          complete: true,
          stable: true,
        },
      },
    },
  });
  const stored = new Map(
    records.map((record) => [seerrRequestReferenceKey(record), record]),
  );
  const newest = new Map<
    string,
    {
      record: (typeof records)[number];
      payload: unknown;
      disposition: PersonalMigrationClaim["disposition"];
    }
  >();
  for (const [key, { claim, payload }] of observations) {
    const record = stored.get(key);
    if (
      record === undefined ||
      !record.capture.complete ||
      !record.capture.stable
    )
      throw new Error("Imported request history lost its exact source capture");
    const previous = newest.get(claim.provenanceKey);
    if (
      previous === undefined ||
      record.capture.completedAt > previous.record.capture.completedAt
    )
      newest.set(claim.provenanceKey, {
        record,
        payload,
        disposition: claim.disposition,
      });
  }
  return [...newest.values()];
}

type SourceRequest = Extract<MigrationRecord, { kind: "request" }>;

type ReviewedHistory = {
  record: Awaited<ReturnType<typeof latestObservations>>[number]["record"];
  selected: PersonalMigrationClaim;
  request: SourceRequest;
};

type BindingScope = Pick<
  Prisma.LegacyRequesterBindingGetPayload<object>,
  "sourceKind" | "sourceInstanceId" | "requesterSourceId"
>;

function bindingScope({ record, request }: ReviewedHistory): BindingScope {
  return {
    sourceKind: record.capture.sourceKind,
    sourceInstanceId: record.capture.sourceInstanceId,
    requesterSourceId: request.requesterSourceId,
  };
}

function bindingKey(scope: BindingScope) {
  return JSON.stringify([
    scope.sourceKind,
    scope.sourceInstanceId,
    scope.requesterSourceId,
  ]);
}

type HistoryAccess = Awaited<ReturnType<typeof assessVisibilityAccess>>;

function acceptsCapturedAccount(
  row: ReviewedHistory,
  user: HistoryAccess["user"],
  reader: NonNullable<HistoryAccess["reader"]>,
) {
  const { request, selected } = row;
  return (
    selected.plexAccountId === user.plexAccountId &&
    request.plexAccountId === user.plexAccountId &&
    (selected.userId === null || selected.userId === user.id) &&
    reader.visible({ kind: titleKind(request.scope), externalIds: {} })
  );
}

function captureRequesterKey(row: ReviewedHistory) {
  return JSON.stringify([row.record.captureId, row.request.requesterSourceId]);
}

async function capturedRequestersForHistory(
  tx: Prisma.TransactionClient,
  rows: readonly ReviewedHistory[],
  user: HistoryAccess["user"],
  reader: NonNullable<HistoryAccess["reader"]>,
) {
  const verified = new Set<string>();
  if (!isIndependentSeerrAccount(user)) return verified;

  const candidates = new Map(
    rows
      .filter((row) => acceptsCapturedAccount(row, user, reader))
      .map((row) => [captureRequesterKey(row), row]),
  );
  for (const [key, row] of candidates) {
    if (
      await captureHasUniquePlexRequester(tx, {
        captureId: row.record.captureId,
        requesterSourceId: row.request.requesterSourceId,
        plexAccountId: user.plexAccountId,
      })
    )
      verified.add(key);
  }
  return verified;
}

async function memberHistory(
  tx: Prisma.TransactionClient,
  rows: readonly ReviewedHistory[],
  access: HistoryAccess,
  canReadManualBindings: boolean,
) {
  const { user, reader } = access;
  if (reader === null || rows.length === 0) return [];

  const scopes = new Map(
    rows.map((row) => {
      const scope = bindingScope(row);
      return [bindingKey(scope), scope];
    }),
  );
  const bindingIds = rows.flatMap(({ selected }) =>
    selected.bindingId === null ? [] : [selected.bindingId],
  );
  const bindings = await tx.legacyRequesterBinding.findMany({
    where: {
      OR: [
        { id: { in: bindingIds } },
        ...[...scopes.values()].map((scope) => ({
          ...scope,
          next: { is: null },
        })),
      ],
    },
    include: { next: { select: { id: true } } },
  });
  const reviewed = new Map(bindings.map((binding) => [binding.id, binding]));
  const latest = new Map(
    bindings
      .filter(({ next }) => next === null)
      .map((binding) => [bindingKey(binding), binding]),
  );
  const identity = snapshotHash(durableBindingIdentity(bindingIdentity(user)));
  const capturedRequesters = await capturedRequestersForHistory(
    tx,
    rows,
    user,
    reader,
  );
  return rows.filter((row) => {
    const { record, selected } = row;
    const key = bindingKey(bindingScope(row));
    const current = latest.get(key);
    const currentMatches =
      current?.userId === user.id &&
      snapshotHash(durableBindingIdentity(current.identitySnapshot)) ===
        identity;
    if (
      capturedRequesters.has(captureRequesterKey(row)) &&
      (current === undefined || currentMatches) &&
      acceptsCapturedAccount(row, user, reader)
    )
      return true;
    if (!canReadManualBindings || !currentMatches) return false;

    const historical =
      selected.bindingId === null
        ? undefined
        : reviewed.get(selected.bindingId);
    return (
      historical?.userId === user.id &&
      historical.revision === selected.bindingRevision &&
      historical.captureId === record.captureId &&
      historical.captureHash === record.capture.manifestHash &&
      bindingKey(historical) === key &&
      snapshotHash(durableBindingIdentity(historical.identitySnapshot)) ===
        identity
    );
  });
}

function titleKind(scope: SourceRequest["scope"]) {
  return scope === "movie" ? "movie" : "series";
}

async function titleReader(
  tx: Prisma.TransactionClient,
  requests: readonly SourceRequest[],
  reader: Awaited<ReturnType<typeof assessVisibilityAccess>>["reader"],
) {
  if (reader === null) return () => null;

  const tmdbIds = (kind: "movie" | "series") => [
    ...new Set(
      requests.flatMap(({ scope, externalIds: { tmdb } }) =>
        tmdb !== undefined && titleKind(scope) === kind ? [tmdb] : [],
      ),
    ),
  ];
  const titles =
    requests.length === 0
      ? []
      : await tx.mediaItem.findMany({
          where: {
            OR: [
              { kind: "movie", tmdbId: { in: tmdbIds("movie") } },
              { kind: "series", tmdbId: { in: tmdbIds("series") } },
            ],
          },
          select: { kind: true, tmdbId: true, externalIds: true, title: true },
        });
  const visible = new Map(
    titles
      .filter((title) => reader.visible(title))
      .map((title) => [`${title.kind}:${String(title.tmdbId)}`, title]),
  );

  return (request: SourceRequest) => {
    const { tmdb, tvdb, imdb } = request.externalIds;
    if (tmdb === undefined) return null;
    const title = visible.get(`${titleKind(request.scope)}:${String(tmdb)}`);
    if (title === undefined) return null;
    try {
      const ids = catalogIdentity(title);
      return ids.tmdb === tmdb &&
        (tvdb === undefined || ids.tvdb === tvdb) &&
        (imdb === undefined || ids.imdb === imdb)
        ? title.title
        : null;
    } catch (error) {
      if (
        error instanceof MediaError &&
        error.code === "catalog_identity_conflict"
      )
        return null;
      throw error;
    }
  };
}

export function importedRequestHistory(
  db: Database,
  actor: MediaActor,
  settings: Parameters<typeof assessVisibilityAccess>[2],
) {
  return repeatableRead(db, async (tx) => {
    const access = await assessVisibilityAccess(tx, actor, settings);
    const { reader, user } = access;
    const owner = user.role === "owner" && !user.restricted;
    const canReadManualBindings =
      settings.serverMachineId !== undefined &&
      eligibleBindingTarget(user, settings.serverMachineId);
    if (
      !owner &&
      !canReadManualBindings &&
      (reader === null || !isIndependentSeerrAccount(user))
    )
      return [];

    const rows: ReviewedHistory[] = [];
    for (const { record, payload, disposition } of await latestObservations(
      tx,
    )) {
      if (disposition !== "history") continue;
      const selection = personalSourceSelection(payload, record);
      if (selection === null)
        throw new Error(
          "Imported request history no longer matches its receipt",
        );
      if (
        !owner &&
        selection.selected.userId !== user.id &&
        selection.selected.plexAccountId !== user.plexAccountId
      )
        continue;
      rows.push({
        record,
        selected: selection.selected,
        request: selection.record,
      });
      if (rows.length > 1000) throw historyLimit();
    }

    const visible = owner
      ? rows
      : await memberHistory(tx, rows, access, canReadManualBindings);
    const readTitle = await titleReader(
      tx,
      visible.map(({ request }) => request),
      reader,
    );
    const history = visible.map(({ record, request }) => ({
      id: record.provenanceKey,
      sourceKind: record.capture.sourceKind,
      scope: request.scope,
      seasonNumbers:
        request.seasonStatuses?.map(({ season }) => season) ?? request.seasons,
      title: readTitle(request),
      requestedAt: request.requestedAt ?? null,
      sourceStatus: request.sourceStatus ?? null,
    }));
    return ImportedRequestHistorySchema.parse(
      history.sort(
        (left, right) =>
          (right.requestedAt ?? "").localeCompare(left.requestedAt ?? "") ||
          left.id.localeCompare(right.id),
      ),
    );
  });
}
