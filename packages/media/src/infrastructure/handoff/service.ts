import type { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { HandoffDetailSchema } from "#shared/handoff.ts";
import {
  PrepareHandoffProtocolSchema,
  HandoffScopeProtocolSchema,
  ApplyHandoffProtocolSchema,
  handoffProtocolVersion,
} from "#shared/handoff/protocol.ts";
import { buildLibraryHandoffScope } from "./library-scope.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { queueOperation } from "#automation/store.ts";
import { buildHandoffScope } from "./scope.ts";
import { runtimeAuthority } from "./authority.ts";

/** Commands only enqueue work; trusted worker observations are never accepted over HTTP. */
export class PrismaMediaHandoff extends MediaCommandBase {
  constructor(private readonly db: Database) {
    super(db, { keepDays: 30 });
  }

  async prepare(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof PrepareHandoffProtocolSchema>,
  ) {
    requireOwner(actor);
    const input = PrepareHandoffProtocolSchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "prepare_handoff", input },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const expectedMode =
          input.activation === "activate" ? "observe" : "active";
        const authority = await runtimeAuthority(tx);
        if (
          runtime.mode !== expectedMode ||
          (input.activation === "activate" && runtime.ownershipConfirmed) ||
          (input.activation === "extend" && !authority.active) ||
          runtime.recoveryEpoch !== input.recoveryEpoch ||
          runtime.version !== input.runtimeVersion
        )
          throw new MediaError(
            "handoff_runtime_changed",
            "Handoff requires the reviewed runtime and authority",
            409,
          );
        const scope =
          "schemaVersion" in input
            ? await buildLibraryHandoffScope(tx, input)
            : await buildHandoffScope(tx, input);
        if (
          !("schemaVersion" in input) &&
          input.purpose === "migration" &&
          scope.files.some((file) => file.libraryKind === "movies")
        )
          throw new MediaError(
            "library_handoff_version_required",
            "Initial movie adoption requires a reviewed per-file classification",
            409,
          );
        const plan = await tx.mediaHandoffPlan.create({
          data: {
            bundleReviewId: input.bundleReviewId,
            actorId: actor.id,
            recoveryEpoch: input.recoveryEpoch,
            runtimeVersion: input.runtimeVersion,
            bundleReviewVersion: input.bundleReviewVersion,
            requestHash: snapshotHash(input),
            scope,
          },
        });
        const operationId = await queueOperation(tx, {
          key: `handoff-prepare:${plan.id}`,
          kind: "prepare_handoff",
          targetId: plan.id,
          userId: actor.id,
          payload: { planId: plan.id },
        });
        return {
          handoffId: plan.id,
          operationId,
          status: "queued",
          version: plan.version,
        };
      },
    );
  }

  async detail(actor: MediaActor, id: string) {
    requireOwner(actor);
    const row = await this.db.mediaHandoffPlan.findUnique({
      where: { id },
      include: { receipt: true },
    });
    if (row === null)
      throw new MediaError(
        "handoff_not_found",
        "Handoff plan does not exist",
        404,
      );
    return HandoffDetailSchema.safeExtend({
      scope: HandoffScopeProtocolSchema,
    }).parse({
      id: row.id,
      state: row.state,
      version: row.version,
      scope: row.scope,
      plan: row.plan,
      planHash: row.planHash,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      receiptId: row.receipt?.id ?? null,
    });
  }

  async apply(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.input<typeof ApplyHandoffProtocolSchema>,
  ) {
    requireOwner(actor);
    const input = ApplyHandoffProtocolSchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "apply_handoff", input: { id, ...input } },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaHandoffPlan" WHERE id = ${id} FOR UPDATE`;
        const plan = await tx.mediaHandoffPlan.findUniqueOrThrow({
          where: { id },
        });
        if (
          handoffProtocolVersion(
            HandoffScopeProtocolSchema.parse(plan.scope),
          ) !== ("schemaVersion" in input ? input.schemaVersion : 1) ||
          plan.state !== "awaiting_review" ||
          plan.version !== input.expectedVersion ||
          plan.planHash !== input.planHash ||
          plan.recoveryEpoch !== input.recoveryEpoch ||
          plan.runtimeVersion !== input.runtimeVersion ||
          plan.expiresAt === null ||
          plan.expiresAt <= new Date()
        )
          throw new MediaError(
            "handoff_review_changed",
            "Inspect and approve a fresh exact handoff plan",
            409,
          );
        await tx.mediaHandoffPlan.update({
          where: { id },
          data: { state: "applying", version: { increment: 1 } },
        });
        const operationId = await queueOperation(tx, {
          key: `handoff-apply:${id}:${input.planHash}`,
          kind:
            "schemaVersion" in input && input.schemaVersion === 3
              ? "apply_library_handoff_v3"
              : "apply_handoff",
          targetId: id,
          userId: actor.id,
          payload: {
            planId: id,
            planHash: input.planHash,
            actorId: actor.id,
            ...("schemaVersion" in input && input.schemaVersion === 3
              ? { schemaVersion: 3 }
              : {}),
          },
        });
        return {
          handoffId: id,
          operationId,
          status: "queued",
          version: plan.version + 1,
        };
      },
    );
  }
}
