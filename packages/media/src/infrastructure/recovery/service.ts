import { currentReview } from "./current-review.ts";
import { z } from "zod";
import { seriesPackNativeCommandInvocationV1 } from "#infrastructure/native-compensation/series-pack/command-invocation.ts";
import { assertSeriesPackNativeHouseholdViewV1 } from "#infrastructure/native-compensation/series-pack/household-view.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  PrepareRecoverySchema,
  RespondRecoverySchema,
  ReleaseRecoverySchema,
  RecoveryScopeSchema,
  RecoveryDetailSchema,
  RecoveryListSchema,
  RecoveryStoredResponseSchema,
  LegacyRespondRecoverySchema,
  isRecoveryScopeV2,
  respondentMediaIds,
} from "#shared/recovery.ts";
import {
  sharedRecoveryMedia,
  lockRecoveryScope,
  snapshotRecoveryScope,
  recoveryConflict,
} from "./scope.ts";
import {
  applyRecoveryDeclarations,
  responseProjection,
  responseJson,
} from "./release.ts";
import { recoveryView } from "./view.ts";
import { recoveryAuthority } from "./authority.ts";
import {
  assertRecoveryRespondent,
  currentRecoveryOwner as currentOwner,
} from "./permissions.ts";
import { claimAccounting } from "./legacy-claims/accounting.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { assertCompensationGroupUnchanged } from "#infrastructure/native-compensation/routing.ts";
import {
  assertLegacyRecoveryProtocol,
  legacyRecoveryReviewIds,
} from "./protocol.ts";

export class PrismaRecovery extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly machineId: string,
    private readonly refreshManaged?: (
      actor: MediaActor,
      userId: string,
    ) => Promise<void>,
  ) {
    super(db, { keepDays: 30 });
  }

  async list(actor: MediaActor) {
    const current = await this.db.mediaUser.findUniqueOrThrow({
      where: { id: actor.id },
      include: { plexIdentity: true },
    });
    const owner = current.role === "owner" && !current.restricted;
    const holds = owner
      ? await this.db.recoveryHold.findMany({
          where: { edition: "default", releasedAt: null },
          include: { media: true },
          take: 100,
          orderBy: { createdAt: "desc" },
        })
      : [];
    const reviews = await this.db.recoveryReview.findMany({
      where: { id: { in: await legacyRecoveryReviewIds(this.db) } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return RecoveryListSchema.parse({
      authority: owner ? await recoveryAuthority(this.db) : null,
      holds: holds.map((hold) => ({
        mediaId: hold.mediaId,
        title: hold.media.title,
        reason: hold.reason,
      })),
      reviews: reviews.flatMap((review) => {
        const scope = recoveryView(
          RecoveryScopeSchema.parse(review.scope),
          current,
          this.machineId,
        );
        return scope.media.length === 0
          ? []
          : [
              {
                id: review.id,
                state: review.state,
                createdAt: review.createdAt.toISOString(),
                titles: scope.media.map((media) => media.title),
              },
            ];
      }),
    });
  }

  async detail(actor: MediaActor, id: string) {
    const invocation = seriesPackNativeCommandInvocationV1();
    const review = await this.db.recoveryReview.findUnique({
      where: { id },
      include: { responses: { orderBy: { userId: "asc" } }, receipt: true },
    });
    if (review === null)
      throw new MediaError(
        "recovery_not_found",
        "Recovery review does not exist",
        404,
      );
    assertLegacyRecoveryProtocol(review.scope);
    const nativeDetail = await this.db.$transaction((tx) =>
      assertSeriesPackNativeHouseholdViewV1(
        tx,
        review,
        invocation.budget,
        invocation.freshness,
      ),
    );
    const current = await this.db.mediaUser.findUniqueOrThrow({
      where: { id: actor.id },
      include: { plexIdentity: true },
    });
    if (nativeDetail)
      invocation.budget.consume(1 + (current.plexIdentity === null ? 0 : 1));
    const owner = current.role === "owner" && !current.restricted;
    const scope = recoveryView(
      RecoveryScopeSchema.parse(review.scope),
      current,
      this.machineId,
    );
    if (scope.media.length === 0)
      throw new MediaError(
        "recovery_forbidden",
        "This recovery review has no currently permitted media",
        403,
      );
    const responses = owner
      ? review.responses
      : review.responses.filter((row) => row.userId === actor.id);
    return RecoveryDetailSchema.parse({
      id,
      state: review.state,
      version: review.version,
      scopeHash: review.scopeHash,
      responseHash: owner ? snapshotHash(responseJson(review.responses)) : null,
      expiresAt: review.expiresAt.toISOString(),
      scope,
      responses: responseProjection(responses).map((row) => ({
        ...row,
        response: {
          ...row.response,
          declarations: row.response.declarations.filter((declaration) =>
            scope.media.some((media) => media.id === declaration.mediaId),
          ),
          ...("schemaVersion" in row.response
            ? {
                claimAcknowledgements:
                  row.response.claimAcknowledgements.filter((ack) =>
                    ack.mediaIds.every((mediaId) =>
                      scope.media.some((media) => media.id === mediaId),
                    ),
                  ),
              }
            : {}),
        },
      })),
      missingUserIds: scope.users
        .filter(
          (user) => !responses.some((response) => response.userId === user.id),
        )
        .map((user) => user.id),
      receiptId: owner ? (review.receipt?.id ?? null) : null,
    });
  }

  async prepare(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof PrepareRecoverySchema>,
  ) {
    requireOwner(actor);
    const invocation = seriesPackNativeCommandInvocationV1();
    const input = PrepareRecoverySchema.parse(raw);
    await currentOwner(this.db, actor);
    if (this.refreshManaged !== undefined) {
      const stale = await this.db.plexIdentityMapping.findMany({
        where: {
          kind: "managed",
          OR: [
            { verifiedAt: null },
            { verifiedAt: { lt: new Date(Date.now() - 300_000) } },
            { verifiedAt: { gt: new Date() } },
          ],
        },
        select: { userId: true },
        take: 101,
      });
      if (stale.length > 100)
        throw recoveryConflict(
          "Household access refresh exceeds the bounded review size",
        );
      for (const subject of stale)
        await this.refreshManaged(actor, subject.userId);
    }
    return this.command(
      actor,
      key,
      { kind: "prepare_recovery_review", input },
      async (db) => {
        const ids = await sharedRecoveryMedia(db, input.mediaIds);
        await lockRecoveryScope(db, ids);
        await assertCompensationGroupUnchanged(db, ids, ids);
        await currentOwner(db, actor);
        const scope = await snapshotRecoveryScope(db, ids, this.machineId, {
          version: 2,
          budget: invocation.budget,
        });
        const review = await db.recoveryReview.create({
          data: {
            actorId: actor.id,
            recoveryEpoch: scope.recoveryEpoch,
            runtimeVersion: scope.runtimeVersion,
            scope: z.record(z.string(), z.json()).parse(scope),
            scopeHash: snapshotHash(nativeJson(scope)),
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
          },
        });
        return {
          recoveryReviewId: review.id,
          status: "completed",
          version: review.version,
        };
      },
    );
  }

  async respond(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.input<typeof RespondRecoverySchema>,
  ) {
    const invocation = seriesPackNativeCommandInvocationV1();
    const input = RespondRecoverySchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "respond_recovery_review", input: { id, ...input } },
      async (db) => {
        const { review, scope } = await currentReview(
          db,
          id,
          this.machineId,
          invocation.budget,
        );
        if (input.scopeHash !== review.scopeHash)
          throw recoveryConflict("Respond to the exact current review");
        const subjectUserId = input.subjectUserId ?? actor.id;
        if (
          !isRecoveryScopeV2(scope) &&
          !LegacyRespondRecoverySchema.safeParse(input).success
        )
          throw recoveryConflict(
            "Prepare a new household review to use managed declarations or legacy claim acknowledgements",
          );
        const authority = await assertRecoveryRespondent(db, {
          scope,
          actor,
          subjectUserId,
          machineId: this.machineId,
        });
        const ids = input.declarations
          .map((declaration) => declaration.mediaId)
          .sort();
        if (
          new Set(ids).size !== ids.length ||
          ids.join(",") !==
            respondentMediaIds(scope, subjectUserId).sort().join(",")
        )
          throw recoveryConflict(
            "Declare intent for each applicable reviewed title exactly once",
          );
        const expectedClaims = isRecoveryScopeV2(scope)
          ? (scope.users.find((user) => user.id === subjectUserId)
              ?.claimAcknowledgements ?? [])
          : [];
        if (
          snapshotHash(expectedClaims) !==
          snapshotHash(input.claimAcknowledgements ?? [])
        )
          throw recoveryConflict(
            "Acknowledge the exact selected legacy claims for this person",
          );
        if (
          await db.recoveryResponse.findUnique({
            where: { reviewId_userId: { reviewId: id, userId: subjectUserId } },
          })
        )
          throw recoveryConflict(
            "Your immutable response already exists; prepare a new review to change it",
          );
        await db.recoveryResponse.create({
          data: {
            reviewId: id,
            userId: subjectUserId,
            actorId: actor.id,
            response: z.record(z.string(), z.json()).parse(
              isRecoveryScopeV2(scope)
                ? {
                    ...input,
                    schemaVersion: 2,
                    subjectUserId,
                    claimAcknowledgements: expectedClaims,
                    authority,
                  }
                : input,
            ),
          },
        });
        await db.recoveryReview.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        return {
          recoveryReviewId: id,
          status: "completed",
          version: review.version + 1,
        };
      },
    );
  }

  async release(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.input<typeof ReleaseRecoverySchema>,
  ) {
    requireOwner(actor);
    const invocation = seriesPackNativeCommandInvocationV1();
    const input = ReleaseRecoverySchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "release_recovery_hold", input: { id, ...input } },
      async (db) => {
        const { review, scope } = await currentReview(
          db,
          id,
          this.machineId,
          invocation.budget,
        );
        await currentOwner(db, actor);
        const authority = await lockRuntimeAuthority(db, scope.recoveryEpoch);
        if (!authority || scope.blockers.length > 0)
          throw recoveryConflict(
            "Recovery protection remains: resolve all scope and household blockers first",
          );
        if (
          review.version !== input.expectedVersion ||
          review.scopeHash !== input.scopeHash
        )
          throw recoveryConflict(
            "Review changed; inspect all current responses again",
          );
        const responses = await db.recoveryResponse.findMany({
          where: { reviewId: id },
          orderBy: { userId: "asc" },
        });
        invocation.budget.consume(responses.length);
        if (
          responses.length !== scope.users.length ||
          scope.users.some(
            (user) =>
              !responses.some((response) => response.userId === user.id),
          )
        )
          throw recoveryConflict(
            "Every household member must explicitly respond; silence cannot release a hold",
          );
        if (snapshotHash(responseJson(responses)) !== input.responseHash)
          throw recoveryConflict("Response review changed");
        for (const response of responses) {
          const declarant = await db.mediaUser.findUniqueOrThrow({
            where: { id: response.actorId },
          });
          const current = await assertRecoveryRespondent(db, {
            scope,
            actor: declarant,
            subjectUserId: response.userId,
            machineId: this.machineId,
          });
          const stored = RecoveryStoredResponseSchema.parse(response.response);
          if (
            isRecoveryScopeV2(scope) &&
            (!("schemaVersion" in stored) ||
              snapshotHash(stored.authority) !== snapshotHash(current))
          )
            throw recoveryConflict(
              "A declaration's current actor or subject authority changed",
            );
        }
        await applyRecoveryDeclarations(db, { reviewId: id, scope, responses });
        const receipt = await db.recoveryReleaseReceipt.create({
          data: {
            reviewId: id,
            actorId: actor.id,
            recoveryEpoch: scope.recoveryEpoch,
            scopeHash: input.scopeHash,
            responseHash: input.responseHash,
            releasedHoldIds: scope.holds.map((hold) => hold.mediaId),
            ...(isRecoveryScopeV2(scope)
              ? { claimAccounting: claimAccounting(scope.legacyClaims) }
              : {}),
          },
        });
        for (const hold of scope.holds) {
          const changed = await db.recoveryHold.updateMany({
            where: {
              edition: "default",
              mediaId: hold.mediaId,
              version: hold.version,
              releasedAt: null,
              recoveryEpoch: scope.recoveryEpoch,
            },
            data: {
              releasedAt: new Date(),
              releasedById: actor.id,
              version: { increment: 1 },
              releaseEvidence: {
                reviewId: id,
                receiptId: receipt.id,
                scopeHash: input.scopeHash,
                responseHash: input.responseHash,
                confirmHouseholdBaseline: true,
                confirmExistingPins: true,
                acknowledgeMissingHistory: true,
              },
            },
          });
          if (changed.count !== 1)
            throw recoveryConflict("Recovery hold changed");
        }
        await queueHouseholdCompensations(
          db,
          {
            mediaIds: scope.media.map((item) => item.id),
            triggerKey: `household:${id}`,
          },
          invocation,
        );
        await db.recoveryReview.update({
          where: { id },
          data: { state: "released", version: { increment: 1 } },
        });
        await db.applicationEvent.create({
          data: {
            actorId: actor.id,
            kind: "recovery_household_reconciled",
            payload: {
              reviewId: id,
              receiptId: receipt.id,
              mediaIds: scope.media.map((media) => media.id),
              recoveryEpoch: scope.recoveryEpoch,
            },
          },
        });
        return {
          recoveryReviewId: id,
          recoveryReceiptId: receipt.id,
          status: "completed",
          version: review.version + 1,
        };
      },
    );
  }
}

import { queueHouseholdCompensations } from "#infrastructure/native-compensation/routing.ts";
