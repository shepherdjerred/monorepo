import type { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import {
  BindLegacyRequesterSchema,
  LegacyRequesterListSchema,
} from "#shared/recovery-claims.ts";
import { MigrationRecordSchema } from "#shared/migration.ts";
import {
  bindingIdentity,
  bindingView,
  claimConflict,
  eligibleBindingTarget,
  lockBindingUsers,
  lockLegacyRequesterBindings,
  requesterEvidence,
} from "./bindings.ts";
import type { Prisma } from "#generated/prisma/client.ts";

async function currentOwner(db: Prisma.TransactionClient, actorId: string) {
  const actor = await db.mediaUser.findUniqueOrThrow({
    where: { id: actorId },
  });
  if (actor.role !== "owner" || actor.restricted)
    throw new MediaError(
      "owner_required",
      "A current unrestricted owner must declare source identities",
      403,
    );
}
export class PrismaLegacyRequesterBindings extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly machineId: string,
  ) {
    super(db, { keepDays: 30 });
  }
  async list(actor: MediaActor, captureId: string) {
    return await this.db.$transaction(async (tx) => {
      await lockBindingUsers(tx, [actor.id]);
      await currentOwner(tx, actor.id);
      const capture = await tx.migrationCapture.findUnique({
        where: { id: captureId },
      });
      if (capture === null)
        throw claimConflict("The exact source capture is unavailable");
      const records = await tx.migrationRecord.findMany({
        where: { captureId, kind: "request" },
        take: 1001,
      });
      if (records.length > 1000)
        throw claimConflict("Capture exceeds bounded requester review");
      const ids = [
        ...new Set(
          records.map((row) => {
            const record = MigrationRecordSchema.parse(row.payload);
            if (record.kind !== "request")
              throw claimConflict("Invalid requester record");
            return record.requesterSourceId;
          }),
        ),
      ].sort();
      if (ids.length > 100)
        throw claimConflict("Capture exceeds 100 requesters");
      const requesters = [];
      for (const requesterSourceId of ids) {
        const evidence = await requesterEvidence(
          tx,
          captureId,
          requesterSourceId,
        );
        const latest = await tx.legacyRequesterBinding.findFirst({
          where: {
            sourceKind: capture.sourceKind,
            sourceInstanceId: capture.sourceInstanceId,
            requesterSourceId,
          },
          orderBy: { revision: "desc" },
        });
        const scoped = await tx.legacyRequesterBinding.findFirst({
          where: {
            captureId,
            sourceKind: capture.sourceKind,
            sourceInstanceId: capture.sourceInstanceId,
            requesterSourceId,
          },
          orderBy: { revision: "desc" },
        });
        requesters.push({
          requesterSourceId,
          requesterEvidenceHash: evidence.requesterEvidenceHash,
          requestCount: evidence.requestCount,
          latestRevision: latest?.revision ?? 0,
          binding: scoped === null ? null : bindingView(scoped),
        });
      }
      const users = await tx.mediaUser.findMany({
        include: { plexIdentity: true },
        orderBy: { id: "asc" },
        take: 101,
      });
      if (users.length > 100)
        throw claimConflict("Household exceeds 100 known subjects");
      return LegacyRequesterListSchema.parse({
        captureId,
        captureHash: capture.manifestHash,
        sourceKind: capture.sourceKind,
        sourceInstanceId: capture.sourceInstanceId,
        requesters,
        targets: users
          .filter((user) => user.plexIdentity !== null)
          .map((user) => ({
            userId: user.id,
            displayName: user.displayName,
            identity: bindingIdentity(user),
            eligible: eligibleBindingTarget(user, this.machineId),
          })),
      });
    });
  }
  async bind(
    actor: MediaActor,
    key: string,
    value: z.input<typeof BindLegacyRequesterSchema>,
  ) {
    const input = BindLegacyRequesterSchema.parse(value);
    // Recheck even an idempotent replay before exposing an owner-only command result.
    await currentOwner(this.db, actor.id);
    return await this.command(
      actor,
      key,
      { kind: "bind_legacy_requester", input },
      async (tx) => {
        await lockBindingUsers(tx, [actor.id, input.userId]);
        await currentOwner(tx, actor.id);
        await lockLegacyRequesterBindings(tx);
        const { capture, requesterEvidenceHash } = await requesterEvidence(
          tx,
          input.captureId,
          input.requesterSourceId,
        );
        if (requesterEvidenceHash !== input.requesterEvidenceHash)
          throw claimConflict("Captured requester evidence changed");
        const user = await tx.mediaUser.findUnique({
          where: { id: input.userId },
          include: { plexIdentity: true },
        });
        if (user === null || !eligibleBindingTarget(user, this.machineId))
          throw claimConflict(
            "Refresh the exact signed-in account or mapped Home profile before binding",
          );
        const prior = await tx.legacyRequesterBinding.findFirst({
          where: {
            sourceKind: capture.sourceKind,
            sourceInstanceId: capture.sourceInstanceId,
            requesterSourceId: input.requesterSourceId,
          },
          orderBy: { revision: "desc" },
        });
        if ((prior?.revision ?? 0) !== input.expectedRevision)
          throw claimConflict(
            "Source requester mapping revision changed; review again",
          );
        const row = await tx.legacyRequesterBinding.create({
          data: {
            sourceKind: capture.sourceKind,
            sourceInstanceId: capture.sourceInstanceId,
            requesterSourceId: input.requesterSourceId,
            captureId: capture.id,
            captureHash: capture.manifestHash,
            requesterEvidenceHash,
            userId: user.id,
            identitySnapshot: bindingIdentity(user),
            actorId: actor.id,
            revision: input.expectedRevision + 1,
            previousId: prior?.id ?? null,
          },
        });
        return { status: "completed", version: row.revision };
      },
    );
  }
}
