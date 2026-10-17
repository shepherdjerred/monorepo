import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import {
  PreparePlexExclusionSchema,
  ExecutePlexExclusionSchema,
  PlexExclusionPlanSchema,
} from "#shared/plex-exclusion.ts";
import { MediaCommandBase } from "./command-base.ts";
import type { Database } from "./database.ts";
import { queueOperation } from "#automation/store.ts";
import { RunJournalSchema } from "#automation/plex-exclusion/state.ts";
import type { MediaAutomationContext } from "#automation/context.ts";

export class PrismaPlexExclusionAdministration extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly describeWorkflow: MediaAutomationContext["describeWorkflow"],
  ) {
    super(db, { keepDays: 7 });
  }
  async list(actor: MediaActor) {
    requireOwner(actor);
    const runtime = await this.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { mode: true, recoveryEpoch: true, version: true },
    });
    const runs = await this.db.plexExclusionRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        state: true,
        version: true,
        planDigest: true,
        recoveryEpoch: true,
        runtimeVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { runtime, runs };
  }
  async prepare(
    actor: MediaActor,
    key: string,
    raw: z.infer<typeof PreparePlexExclusionSchema>,
  ) {
    requireOwner(actor);
    const input = PreparePlexExclusionSchema.parse(raw);
    return await this.command(
      actor,
      key,
      { kind: "plex_exclusion_prepare", input },
      async (tx) => {
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        if (
          runtime.mode !== "observe" ||
          runtime.version !== input.expectedRuntimeVersion
        )
          throw new MediaError(
            "runtime_conflict",
            "Prepare requires the current observe-mode runtime version",
            409,
          );
        const run = await tx.plexExclusionRun.create({
          data: {
            ownerId: actor.id,
            state: "preparing",
            recoveryEpoch: runtime.recoveryEpoch,
            runtimeVersion: runtime.version,
            planDigest: "pending",
            plan: { kind: input.kind },
            journal: {},
          },
        });
        const operationId = await queueOperation(tx, {
          key: `plex-prepare:${run.id}`,
          kind: "plex_exclusion_prepare",
          userId: actor.id,
          targetId: run.id,
          payload: { runId: run.id },
        });
        return {
          operationId,
          status: "queued",
          version: run.version,
          runId: run.id,
        };
      },
    );
  }
  async detail(actor: MediaActor, id: string) {
    requireOwner(actor);
    z.uuid().parse(id);
    const run = await this.db.plexExclusionRun.findUniqueOrThrow({
      where: { id },
    });
    const journal = RunJournalSchema.parse(run.journal);
    return {
      id: run.id,
      state: run.state,
      version: run.version,
      recoveryEpoch: run.recoveryEpoch,
      runtimeVersion: run.runtimeVersion,
      planDigest: run.planDigest,
      plan:
        ["preparing", "topology_prepared"].includes(run.state) ||
        run.planDigest === "pending"
          ? null
          : PlexExclusionPlanSchema.parse(run.plan),
      reason:
        journal.reason ??
        journal.cleanupScan?.reason ??
        journal.scan?.reason ??
        null,
      probeSha256: journal.files?.probeSha256 ?? null,
      cleanupReview: journal.cleanupReview ?? {},
      filesCleanedAt: journal.files?.cleanedAt ?? null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }
  async execute(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.infer<typeof ExecutePlexExclusionSchema>,
  ) {
    requireOwner(actor);
    z.uuid().parse(id);
    const input = ExecutePlexExclusionSchema.parse(raw);
    return await this.command(
      actor,
      key,
      { kind: "plex_exclusion_execute", input: { id, ...input } },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "PlexExclusionRun" WHERE id = ${id} FOR UPDATE`;
        const run = await tx.plexExclusionRun.findUniqueOrThrow({
          where: { id },
        });
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        if (
          run.ownerId !== actor.id ||
          run.state !== "prepared" ||
          run.version !== input.expectedVersion ||
          run.planDigest !== input.planDigest ||
          runtime.mode !== "observe" ||
          runtime.recoveryEpoch !== run.recoveryEpoch ||
          runtime.version !== run.runtimeVersion
        )
          throw new MediaError(
            "exclusion_conflict",
            "The reviewed exclusion plan or runtime changed; prepare again",
            409,
          );
        const updated = await tx.plexExclusionRun.update({
          where: { id },
          data: { state: "approved", version: { increment: 1 } },
        });
        const operationId = await queueOperation(tx, {
          key: `plex-execute:${id}`,
          kind: "plex_exclusion_execute",
          userId: actor.id,
          targetId: id,
          payload: { runId: id },
        });
        return {
          operationId,
          status: "queued",
          version: updated.version,
          runId: id,
        };
      },
    );
  }

  async recover(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.infer<typeof ExecutePlexExclusionSchema>,
  ) {
    requireOwner(actor);
    z.uuid().parse(id);
    const input = ExecutePlexExclusionSchema.parse(raw);
    const replay = await this.db.idempotencyRecord.findUnique({
      where: { userId_key: { userId: actor.id, key } },
    });
    if (replay !== null)
      return await this.command(
        actor,
        key,
        { kind: "plex_exclusion_recover", input: { id, ...input } },
        () =>
          Promise.reject(
            new Error("Existing idempotency response disappeared"),
          ),
      );
    const prior = await this.db.operation.findFirst({
      where: {
        targetId: id,
        kind: { in: ["plex_exclusion_execute", "plex_exclusion_recover"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (prior === null)
      throw new MediaError(
        "exclusion_conflict",
        "No prior execution exists to recover",
        409,
      );
    const workflow = await this.describeWorkflow(`media-operation-${prior.id}`);
    if (
      workflow === null ||
      !["COMPLETED", "FAILED", "CANCELLED", "TERMINATED", "TIMED_OUT"].includes(
        workflow.status,
      )
    )
      throw new MediaError(
        "exclusion_busy",
        "Prior workflow must be confirmed terminal before recovery",
        409,
      );
    return await this.command(
      actor,
      key,
      { kind: "plex_exclusion_recover", input: { id, ...input } },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "PlexExclusionRun" WHERE id = ${id} FOR UPDATE`;
        const run = await tx.plexExclusionRun.findUniqueOrThrow({
          where: { id },
        });
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const latest = await tx.operation.findFirst({
          where: {
            targetId: id,
            kind: { in: ["plex_exclusion_execute", "plex_exclusion_recover"] },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        if (
          latest?.id !== prior.id ||
          run.ownerId !== actor.id ||
          run.state !== "intervention" ||
          run.version !== input.expectedVersion ||
          run.planDigest !== input.planDigest ||
          runtime.mode !== "observe" ||
          runtime.recoveryEpoch !== run.recoveryEpoch ||
          runtime.version !== run.runtimeVersion
        )
          throw new MediaError(
            "exclusion_conflict",
            "Recovery requires the exact current same-epoch intervention plan",
            409,
          );
        const operationId = await queueOperation(tx, {
          key: `plex-recover:${id}:${String(run.version)}`,
          kind: "plex_exclusion_recover",
          userId: actor.id,
          targetId: id,
          payload: {
            runId: id,
            previousOperationId: prior.id,
            previousWorkflowRunId: workflow.runId,
          },
        });
        const journal = RunJournalSchema.parse(run.journal);
        const updated = await tx.plexExclusionRun.update({
          where: { id },
          data: {
            version: { increment: 1 },
            journal: {
              ...journal,
              recoveryStartedAt: new Date().toISOString(),
              ...(journal.cleanupScan === undefined
                ? {}
                : {
                    cleanupScan: {
                      ...journal.cleanupScan,
                      state: "waiting",
                      first: null,
                      second: null,
                    },
                  }),
            },
          },
        });
        return {
          operationId,
          runId: id,
          version: updated.version,
          status: "queued",
        };
      },
    );
  }
}
