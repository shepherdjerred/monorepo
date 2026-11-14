import {
  Prisma,
  type WatchState,
  type PlexWatchProjection,
} from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { RETENTION_DEFAULTS } from "#domain/retention.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { lockWatchAuthority, type WatchAuthority } from "./authority.ts";
import type { PreparedWatchBatch } from "./prepare.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { queueMovieRetentionFromWatch } from "#automation/movie-editions/retention/queue.ts";
import {
  commitBoundWatch,
  queueQuarantinedUnwatchedRestore,
  parseWatchProjectionAuthority,
} from "#infrastructure/plex-binding/watch.ts";
import { releasedWatchMayKeepWarning } from "./released-interest.ts";
import { quarantinedReleaseObservationOnly } from "#infrastructure/request-interest/quarantine-release.ts";
import type { BoundWatchAuthority } from "#shared/plex-binding/watch.ts";
import {
  watchAwait,
  assertWatchActive,
  type WatchExecution,
} from "./execution.ts";

export type WatchOutcome = {
  userId: string;
  outcome:
    | {
        kind: "observed";
        watched: boolean;
        /** Boolean-only historical callers supply no fresh counter evidence. */
        viewCount?: number | null;
        scopedAccess: boolean;
        freshness: PlexBindingFreshness;
      }
    | { kind: "unknown" };
};

export async function queueCurrentRetention(
  tx: Prisma.TransactionClient,
  authority: WatchAuthority,
  bucket: string,
  execution: WatchExecution,
): Promise<void> {
  if (await queueMovieRetentionFromWatch(tx, authority, bucket, execution))
    return;
  const intent = await watchAwait(
    execution,
    tx.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(authority.media.id)),
    }),
  );
  if (intent.automationEpoch !== authority.runtime.recoveryEpoch) return;
  await watchAwait(
    execution,
    queueOperation(tx, {
      key: `retention:${authority.media.id}:${String(intent.generation)}:${bucket}`,
      kind: "retain_media",
      targetId: authority.media.id,
      payload: { mediaId: authority.media.id, generation: intent.generation },
      ...(authority.nativeCompensationProtocol === "series_pack_publication_v3"
        ? { budget: authority.scope.budget }
        : {}),
    }),
  );
}

export async function finalizeWatchBatch(
  context: MediaAutomationContext,
  prepared: PreparedWatchBatch,
  outcomes: readonly WatchOutcome[],
  execution: WatchExecution,
): Promise<"committed" | "unknown" | "superseded"> {
  if (
    new Set(outcomes.map((item) => item.userId)).size !==
      prepared.readers.length ||
    outcomes.length !== prepared.readers.length ||
    prepared.readers.some(
      (reader) => !outcomes.some((item) => item.userId === reader.userId),
    )
  )
    throw new Error("Watch batch outcomes do not match its complete cohort");
  const scope = prepared.authority.scope;
  const edition = scope.edition ?? "default";
  const bindingScope = scope.bindingScope;
  if (bindingScope === null || prepared.authority.binding === null)
    throw new Error("Prepared watch omitted its binding scope");
  prepared.freshness.assertActive();
  const access = await context.plexAccess(bindingScope.access.sectionType);
  prepared.freshness.assertActive();
  const configCurrent =
    identityHash(access) === identityHash(bindingScope.access);
  const active = {
    ...execution,
    assertActive: () => {
      assertWatchActive(execution);
      prepared.freshness.assertActive();
    },
  };
  return await serializable(context.db, async (tx) => {
    const authority = await lockWatchAuthority(tx, scope, active);
    if (authority === null) return "superseded";
    const same =
      configCurrent &&
      authority.hintCurrent &&
      authority.signature === prepared.authority.signature &&
      identityHash(authority.binding?.authority ?? null) ===
        identityHash(prepared.authority.binding?.authority ?? null);
    await bindPlexTransactionDeadline(tx, prepared.freshness);
    await watchAwait(
      execution,
      tx.$queryRaw(
        Prisma.sql`SELECT "mediaId" FROM "WatchObservationFence" WHERE "mediaId" IN (${Prisma.join(bindingScope.mediaIds)}) AND edition=${edition} ORDER BY "mediaId" FOR UPDATE`,
      ),
    );
    const fence = await watchAwait(
      execution,
      tx.watchObservationFence.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: prepared.mediaId, edition } },
      }),
    );
    if (
      fence.issuedRevision !== prepared.revision ||
      fence.settledRevision >= prepared.revision
    )
      return "superseded";
    const now = Date.now();
    if (
      prepared.startedAt.getTime() > now ||
      now - prepared.startedAt.getTime() > RETENTION_DEFAULTS.maximumWatchAgeMs
    )
      return "superseded";
    if (
      outcomes.some(
        (item) =>
          item.outcome.kind === "observed" &&
          !item.outcome.scopedAccess &&
          authority.participants.some(
            (user) =>
              user.id === item.userId &&
              (user.plexIdentity?.verifiedAt === null ||
                user.plexIdentity?.verifiedAt === undefined ||
                now - user.plexIdentity.verifiedAt.getTime() > 300_000),
          ),
      )
    )
      return "superseded";
    for (const result of outcomes) {
      if (same && result.outcome.kind === "observed") {
        result.outcome.freshness.assertActive();
        await bindPlexTransactionDeadline(tx, result.outcome.freshness);
      }
      await applyOutcome(
        tx,
        {
          prepared,
          authority,
          result: same
            ? result
            : { userId: result.userId, outcome: { kind: "unknown" } },
          settledRevision: fence.settledRevision,
        },
        active,
      );
    }
    await watchAwait(
      execution,
      tx.watchObservationFence.update({
        where: { mediaId_edition: { mediaId: prepared.mediaId, edition } },
        data: { settledRevision: prepared.revision },
      }),
    );
    await queueHintRetention(tx, prepared, authority, execution);
    prepared.freshness.assertActive();
    return same ? "committed" : "unknown";
  });
}

async function queueHintRetention(
  tx: Prisma.TransactionClient,
  prepared: PreparedWatchBatch,
  authority: WatchAuthority,
  execution: WatchExecution,
) {
  if (prepared.expectedHint === undefined) return;
  await queueCurrentRetention(
    tx,
    authority,
    `plex-hint:${prepared.expectedHint.operationId}`,
    execution,
  );
}

async function applyOutcome(
  tx: Prisma.TransactionClient,
  input: {
    prepared: PreparedWatchBatch;
    authority: WatchAuthority;
    result: WatchOutcome;
    settledRevision: bigint;
  },
  execution: WatchExecution,
) {
  const { prepared, result } = input;
  const edition = prepared.authority.scope.edition ?? "default";
  const original = prepared.authority.binding;
  if (original === null)
    throw new Error("Prepared watch omitted its immutable association");
  if (result.outcome.kind === "unknown") {
    await watchAwait(
      execution,
      commitBoundWatch(
        tx,
        {
          userId: result.userId,
          authority: original.authority,
          watchBatchRevision: prepared.revision,
          observedAt: prepared.startedAt,
          watched: null,
        },
        prepared.freshness,
        prepared.authority.scope.budget,
      ),
    );
    return;
  }
  const committed = await watchAwait(
    execution,
    commitBoundWatch(
      tx,
      {
        userId: result.userId,
        authority: original.authority,
        watchBatchRevision: prepared.revision,
        observedAt: prepared.startedAt,
        watched: result.outcome.watched,
        viewCount: result.outcome.viewCount ?? null,
      },
      result.outcome.freshness,
      prepared.authority.scope.budget,
    ),
  );
  const prior = committed.previousWatchState;
  const stableReleasedUnwatched =
    original.authority.purpose === "current_serving" &&
    !result.outcome.watched &&
    prior?.watched === false &&
    releasedWatchMayKeepWarning(input.authority, result.userId, new Date()) &&
    priorCurrentUnwatched({
      prior,
      projection: committed.previousProjection,
      authority: original.authority,
      settledRevision: input.settledRevision,
    });
  if (result.outcome.watched) return;
  if (original.authority.purpose === "quarantined") {
    if (
      quarantinedReleaseObservationOnly(
        input.authority,
        result.userId,
        new Date(),
      )
    )
      return;
    const restored = await watchAwait(
      execution,
      queueQuarantinedUnwatchedRestore(
        tx,
        {
          authority: original.authority,
          userId: result.userId,
          watchBatchRevision: prepared.revision,
        },
        result.outcome.freshness,
        prepared.authority.scope.budget,
      ),
    );
    assertExpectedQuarantineObservation(
      restored,
      input.authority,
      result.userId,
    );
    return;
  }
  const mediaIds = prepared.authority.scope.bindingScope?.mediaIds;
  if (mediaIds === undefined) throw new Error("Watch group disappeared");
  const outstanding = await watchAwait(
    execution,
    tx.retentionDecision.count({
      where: {
        mediaId: { in: mediaIds },
        edition,
        state: { in: ["eligible", "warning_pending", "grace_period"] },
      },
    }),
  );
  if (outstanding === 0 && prior?.watched !== true) return;
  if (stableReleasedUnwatched) return;
  await watchAwait(
    execution,
    tx.mediaItem.updateMany({
      where: { id: { in: mediaIds } },
      data: { version: { increment: 1 } },
    }),
  );
  await watchAwait(
    execution,
    tx.mediaIntent.updateMany({
      where: { mediaId: { in: mediaIds }, edition },
      data: { generation: { increment: 1 }, version: { increment: 1 } },
    }),
  );
  await watchAwait(
    execution,
    tx.retentionDecision.updateMany({
      where: {
        mediaId: { in: mediaIds },
        edition,
        state: { in: ["eligible", "warning_pending", "grace_period"] },
      },
      data: { state: "cancelled", version: { increment: 1 } },
    }),
  );
  const intent = await watchAwait(
    execution,
    tx.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: prepared.mediaId, edition } },
    }),
  );
  await watchAwait(
    execution,
    tx.applicationEvent.create({
      data: {
        mediaId: prepared.mediaId,
        actorId: result.userId,
        kind: "media_marked_unwatched",
        payload: {
          generation: intent.generation,
          ...(edition === "default" ? {} : { edition }),
        },
      },
    }),
  );
}

function assertExpectedQuarantineObservation(
  restored: { operationId: string; created: boolean } | null,
  authority: WatchAuthority,
  userId: string,
) {
  if (
    restored === null &&
    !quarantinedReleaseObservationOnly(authority, userId, new Date())
  )
    throw new Error(
      "Quarantine restore omitted demand without a current final release",
    );
}

/** The current physical binding was already revalidated under this scope lock.
 * Verify the prior settled native projection against that exact binding without
 * traversing physical ancestry a second time for every participant. */
function priorCurrentUnwatched(input: {
  prior: WatchState;
  projection: PlexWatchProjection | null;
  authority: BoundWatchAuthority;
  settledRevision: bigint;
}) {
  if (
    input.prior.source !== "plex_current" ||
    input.prior.watched ||
    input.prior.observedAt.getTime() > Date.now() ||
    Date.now() - input.prior.observedAt.getTime() >
      RETENTION_DEFAULTS.maximumWatchAgeMs
  )
    return false;
  const projection = input.projection;
  if (projection === null) return false;
  const stored = parseWatchProjectionAuthority(projection);
  return (
    !projection.watched &&
    projection.observedAt.getTime() === input.prior.observedAt.getTime() &&
    projection.watchBatchRevision === input.settledRevision &&
    identityHash(stored) === identityHash(input.authority)
  );
}
