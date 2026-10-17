import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { queueOperation } from "#automation/store.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { captureReplacementSnapshot } from "#automation/subtitle-replacement/snapshot.ts";
import {
  PrepareSubtitleReplacementSchema,
  ApplySubtitleReplacementSchema,
  ReconcileSubtitleReplacementSchema,
  SubtitleReplacementSnapshotSchema,
  SubtitleReplacementListSchema,
} from "#shared/subtitle-replacement.ts";
import {
  lockSubtitleReplacementScope,
  assertReplacementOwner,
} from "./locks.ts";
import { replacementDetail } from "./view.ts";
import { assertReplacementCoordinatorTerminal } from "./terminal.ts";

export class PrismaSubtitleReplacements extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly describe: MediaAutomationContext["describeWorkflow"],
  ) {
    super(db, { keepDays: 30 });
  }

  async list(actor: MediaActor, cursor: string | null = null) {
    requireOwner(actor);
    return this.db.$transaction(async (tx) => {
      await assertReplacementOwner(tx, actor.id);
      const rows = await tx.subtitleReplacement.findMany({
        where: cursor === null ? {} : { id: { gt: z.uuid().parse(cursor) } },
        include: { review: true, receipt: true },
        orderBy: { id: "asc" },
        take: 51,
      });
      return SubtitleReplacementListSchema.parse({
        items: rows.slice(0, 50).map((row) => replacementDetail(row)),
        nextCursor: rows.length > 50 ? rows[49]?.id : null,
      });
    });
  }
  async detail(actor: MediaActor, id: string) {
    requireOwner(actor);
    return this.db.$transaction(async (tx) => {
      await assertReplacementOwner(tx, actor.id);
      const row = await tx.subtitleReplacement.findUnique({
        where: { id },
        include: { review: true, receipt: true },
      });
      if (row === null)
        throw new MediaError(
          "subtitle_replacement_missing",
          "Subtitle replacement does not exist",
          404,
        );
      return replacementDetail(row);
    });
  }
  async prepare(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof PrepareSubtitleReplacementSchema>,
  ) {
    requireOwner(actor);
    const input = PrepareSubtitleReplacementSchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "prepare_subtitle_replacement", input },
      async (tx) => {
        const old = await tx.subtitleAsset.findUniqueOrThrow({
          where: { id: input.oldSubtitleId },
          include: {
            asset: { include: { coverage: { where: { current: true } } } },
          },
        });
        await lockSubtitleReplacementScope(tx, {
          assetId: old.assetId,
          mediaIds: old.asset.coverage.map((item) => item.mediaId),
        });
        await assertReplacementOwner(tx, actor.id);
        const runtime = await runtimeAuthority(tx);
        if (!runtime.active)
          throw new MediaError(
            "runtime_protected",
            "Current writer and runtime authority is required",
            409,
          );
        const snapshot = await captureReplacementSnapshot(tx, {
          assetId: old.assetId,
          oldSubtitleId: old.id,
          candidateSubtitleId: input.candidateSubtitleId,
          epoch: runtime.epoch,
        });
        if (
          snapshot.old.version !== input.expectedOldVersion ||
          snapshot.candidate.version !== input.expectedCandidateVersion
        )
          throw new MediaError(
            "subtitle_replacement_changed",
            "Inspect the current subtitle versions before preparing",
            409,
          );
        const id = crypto.randomUUID();
        const row = await tx.subtitleReplacement.create({
          data: {
            id,
            ownerId: actor.id,
            assetId: old.assetId,
            oldSubtitleId: old.id,
            candidateSubtitleId: input.candidateSubtitleId,
            recoveryEpoch: runtime.epoch,
            runtimeVersion: snapshot.runtimeVersion,
            snapshot: z.record(z.string(), z.json()).parse(snapshot),
            snapshotHash: snapshotHash(z.json().parse(snapshot)),
            importOperationId: `subtitle-replace-${id}`,
            rollbackOperationId: `subtitle-revert-${id}`,
          },
        });
        const operationId = await queueOperation(tx, {
          key: `subtitle-replacement-prepare:${id}`,
          kind: "prepare_subtitle_replacement",
          targetId: id,
          userId: actor.id,
          payload: { replacementId: id },
        });
        await tx.subtitleReplacement.update({
          where: { id },
          data: { coordinatorOperationId: operationId },
        });
        return {
          subtitleReplacementId: id,
          operationId,
          status: "queued",
          version: row.version,
        };
      },
    );
  }
  async apply(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.input<typeof ApplySubtitleReplacementSchema>,
  ) {
    requireOwner(actor);
    const input = ApplySubtitleReplacementSchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "apply_subtitle_replacement", input: { id, ...input } },
      async (tx) => {
        const initial = await tx.subtitleReplacement.findUniqueOrThrow({
          where: { id },
        });
        const scope = SubtitleReplacementSnapshotSchema.parse(initial.snapshot);
        await lockSubtitleReplacementScope(tx, {
          assetId: initial.assetId,
          mediaIds: scope.asset.coverage.map((item) => item.mediaId),
          replacementId: id,
        });
        await assertReplacementOwner(tx, actor.id);
        const row = await tx.subtitleReplacement.findUniqueOrThrow({
          where: { id },
          include: { review: true },
        });
        const runtime = await runtimeAuthority(tx);
        if (!runtime.active || runtime.epoch !== row.recoveryEpoch)
          throw new MediaError(
            "runtime_protected",
            "Replacement belongs to unavailable runtime authority",
            409,
          );
        const current = await captureReplacementSnapshot(tx, {
          assetId: row.assetId,
          oldSubtitleId: row.oldSubtitleId,
          candidateSubtitleId: row.candidateSubtitleId,
          epoch: row.recoveryEpoch,
        });
        if (
          snapshotHash(z.json().parse(current)) !== row.snapshotHash ||
          row.state !== "awaiting_review" ||
          row.version !== input.expectedVersion ||
          !row.reservationActive ||
          row.review?.observationHash !== input.observationHash ||
          row.review.expiresAt <= new Date() ||
          row.review.approvedAt !== null
        )
          throw new MediaError(
            "subtitle_replacement_review_changed",
            "A current exact replacement review is required",
            409,
          );
        await tx.subtitleReplacementReview.update({
          where: { replacementId: id },
          data: { approvedById: actor.id, approvedAt: new Date() },
        });
        await tx.subtitleReplacement.update({
          where: { id },
          data: { state: "applying", version: { increment: 1 } },
        });
        const operationId = await queueOperation(tx, {
          key: `subtitle-replacement-apply:${id}:${input.observationHash}`,
          kind: "apply_subtitle_replacement",
          targetId: id,
          userId: actor.id,
          payload: {
            replacementId: id,
            observationHash: input.observationHash,
            actorId: actor.id,
          },
        });
        await tx.subtitleReplacement.update({
          where: { id },
          data: { coordinatorOperationId: operationId },
        });
        return {
          subtitleReplacementId: id,
          operationId,
          status: "queued",
          version: row.version + 1,
        };
      },
    );
  }
  async reconcile(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.input<typeof ReconcileSubtitleReplacementSchema>,
  ) {
    requireOwner(actor);
    const input = ReconcileSubtitleReplacementSchema.parse(raw);
    await this.detail(actor, id);
    const command = {
      kind: "reconcile_subtitle_replacement",
      input: { id, ...input },
    };
    const prior = await this.db.idempotencyRecord.findUnique({
      where: { userId_key: { userId: actor.id, key } },
    });
    if (prior !== null)
      return this.command(actor, key, command, () =>
        Promise.reject(
          new Error("Persisted replacement idempotency record disappeared"),
        ),
      );
    const proof = await assertReplacementCoordinatorTerminal(
      this.db,
      this.describe,
      id,
    );
    return this.command(actor, key, command, async (tx) => {
      const initial = await tx.subtitleReplacement.findUniqueOrThrow({
        where: { id },
      });
      const scope = SubtitleReplacementSnapshotSchema.parse(initial.snapshot);
      await lockSubtitleReplacementScope(tx, {
        assetId: initial.assetId,
        mediaIds: scope.asset.coverage.map((item) => item.mediaId),
        replacementId: id,
      });
      await assertReplacementOwner(tx, actor.id);
      const row = await tx.subtitleReplacement.findUniqueOrThrow({
        where: { id },
      });
      if (
        row.version !== input.expectedVersion ||
        row.version !== proof.version ||
        !row.reservationActive
      )
        throw new MediaError(
          "subtitle_replacement_changed",
          "Replacement changed during workflow reconciliation",
          409,
        );
      await tx.subtitleReplacement.update({
        where: { id },
        data: { state: "reconciling", version: { increment: 1 } },
      });
      const operationId = await queueOperation(tx, {
        key: `subtitle-replacement-reconcile:${id}:${String(row.version)}`,
        kind: "reconcile_subtitle_replacement",
        targetId: id,
        userId: actor.id,
        payload: {
          replacementId: id,
          actorId: actor.id,
          coordinators: proof.executions,
        },
      });
      await tx.subtitleReplacement.update({
        where: { id },
        data: { coordinatorOperationId: operationId },
      });
      return {
        subtitleReplacementId: id,
        operationId,
        status: "queued",
        version: row.version + 1,
      };
    });
  }
}
