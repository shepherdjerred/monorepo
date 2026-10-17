import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { RETENTION_DEFAULTS } from "#domain/retention.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import {
  lockWatchAuthority,
  watchScope,
  type WatchAuthority,
} from "./authority.ts";
import type { PreparedWatchBatch } from "./prepare.ts";
import {
  watchAwait,
  assertWatchActive,
  type WatchExecution,
} from "./execution.ts";

export type WatchOutcome = {
  userId: string;
  outcome:
    | { kind: "observed"; watched: boolean; scopedAccess: boolean }
    | { kind: "unknown" };
};

export async function queueCurrentRetention(
  tx: Prisma.TransactionClient,
  authority: WatchAuthority,
  bucket: string,
  execution: WatchExecution,
): Promise<void> {
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
    }),
  );
}

export async function finalizeWatchBatch(
  context: MediaAutomationContext,
  prepared: PreparedWatchBatch,
  outcomes: readonly WatchOutcome[],
  execution: WatchExecution,
): Promise<"committed" | "superseded"> {
  if (
    new Set(outcomes.map((item) => item.userId)).size !==
      prepared.readers.length ||
    outcomes.length !== prepared.readers.length ||
    prepared.readers.some(
      (reader) => !outcomes.some((item) => item.userId === reader.userId),
    )
  )
    throw new Error("Watch batch outcomes do not match its complete cohort");
  const scope = await watchScope(
    context,
    prepared.mediaId,
    prepared.expectedHint === undefined
      ? {}
      : { expectedHint: prepared.expectedHint },
    execution,
  );
  return await serializable(context.db, async (tx) => {
    const authority = await lockWatchAuthority(tx, scope, execution);
    if (authority?.signature !== prepared.authority.signature)
      return "superseded";
    await watchAwait(
      execution,
      tx.$queryRaw`SELECT "mediaId" FROM "WatchObservationFence" WHERE "mediaId"=${prepared.mediaId} AND edition='default' FOR UPDATE`,
    );
    const fence = await watchAwait(
      execution,
      tx.watchObservationFence.findUniqueOrThrow({
        where: { mediaId_edition: defaultScope(prepared.mediaId) },
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
    for (const result of outcomes)
      await applyOutcome(tx, { prepared, authority, result }, execution);
    await watchAwait(
      execution,
      tx.watchObservationFence.update({
        where: { mediaId_edition: defaultScope(prepared.mediaId) },
        data: { settledRevision: prepared.revision },
      }),
    );
    if (prepared.expectedHint !== undefined)
      await queueCurrentRetention(
        tx,
        authority,
        `plex-hint:${prepared.expectedHint.operationId}`,
        execution,
      );
    assertWatchActive(execution);
    return "committed";
  });
}

async function applyOutcome(
  tx: Prisma.TransactionClient,
  input: {
    prepared: PreparedWatchBatch;
    authority: WatchAuthority;
    result: WatchOutcome;
  },
  execution: WatchExecution,
) {
  const { prepared, authority, result } = input;
  const key = { userId: result.userId, ...defaultScope(prepared.mediaId) };
  if (result.outcome.kind === "unknown") {
    await watchAwait(execution, tx.watchState.deleteMany({ where: key }));
    return;
  }
  const prior = await watchAwait(
    execution,
    tx.watchState.findUnique({ where: { userId_mediaId_edition: key } }),
  );
  await watchAwait(
    execution,
    tx.watchState.upsert({
      where: { userId_mediaId_edition: key },
      create: {
        ...key,
        watched: result.outcome.watched,
        observedAt: prepared.startedAt,
        source: "plex_current",
      },
      update: {
        watched: result.outcome.watched,
        observedAt: prepared.startedAt,
        source: "plex_current",
      },
    }),
  );
  if (result.outcome.watched) return;
  const outstanding = await watchAwait(
    execution,
    tx.retentionDecision.count({
      where: {
        ...defaultScope(prepared.mediaId),
        state: { in: ["eligible", "warning_pending", "grace_period"] },
      },
    }),
  );
  if (outstanding === 0 && prior?.watched !== true) return;
  await watchAwait(
    execution,
    tx.mediaItem.update({
      where: { id: prepared.mediaId },
      data: { version: { increment: 1 } },
    }),
  );
  const intent = await watchAwait(
    execution,
    tx.mediaIntent.update({
      where: targetWhere(defaultScope(prepared.mediaId)),
      data: { generation: { increment: 1 }, version: { increment: 1 } },
    }),
  );
  await watchAwait(
    execution,
    tx.retentionDecision.updateMany({
      where: {
        ...defaultScope(prepared.mediaId),
        state: { in: ["eligible", "warning_pending", "grace_period"] },
      },
      data: { state: "cancelled", version: { increment: 1 } },
    }),
  );
  await watchAwait(
    execution,
    tx.applicationEvent.create({
      data: {
        mediaId: prepared.mediaId,
        actorId: result.userId,
        kind: "media_marked_unwatched",
        payload: { generation: intent.generation },
      },
    }),
  );
  if (
    authority.target.availability === "quarantined" &&
    intent.automationEpoch === authority.runtime.recoveryEpoch
  )
    await watchAwait(
      execution,
      queueOperation(tx, {
        key: `unwatched-restore:${prepared.mediaId}:${String(intent.generation)}`,
        kind: "restore_media",
        targetId: prepared.mediaId,
        payload: { mediaId: prepared.mediaId, generation: intent.generation },
      }),
    );
}
