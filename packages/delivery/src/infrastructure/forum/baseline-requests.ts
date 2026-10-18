import {
  ForumBaselineContextSchema,
  PipelineRevisionSchema,
} from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import {
  ForumBaselineIntentSchema,
  RequestForumBaselineSchema,
} from "#shared/forum-contract.ts";
import type { RequestForumBaseline } from "#shared/forum-contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  remember,
  request,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import { forumBaselineInputs, lockForumBaseline } from "./baseline-context.ts";
import { artifact, environment } from "#infrastructure/delivery-data.ts";

export async function requestForumBaseline(
  this: Delivery,
  raw: RequestForumBaseline,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const input = RequestForumBaselineSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    const prior = await request(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "forum-baseline",
    });
    if (prior !== null)
      return ForumBaselineIntentSchema.parse(
        wire(
          required(
            await tx.forumBaselineIntent.findUnique({
              where: { id: prior.resultId },
            }),
            "Forum baseline",
          ),
        ),
      );
    await lockForumBaseline(tx, input.environmentId);
    const context = await forumBaselineInputs(tx, input);
    if (
      (await tx.forumBaselineIntent.findFirst({
        where: { environmentId: input.environmentId, status: "pending" },
      })) !== null
    )
      throw new DeliveryError(
        "CONFLICT",
        "Forum environment already has a pending original baseline",
      );
    const intent = await tx.forumBaselineIntent.create({
      data: {
        id: input.requestId,
        environmentId: input.environmentId,
        imageArtifactId: input.imageArtifactId,
        bundleArtifactId: input.bundleArtifactId,
        requestedBy: actor.id,
        reason: input.reason,
        expectedEnvironmentGeneration: input.expectedEnvironmentGeneration,
        pipelineRevisionId: context.pipeline.id,
        configurationRevision: context.environment.configurationRevision,
        snapshotFingerprint: context.snapshotFingerprint,
        workflowId: `delivery-forum-baseline/${input.requestId}`,
      },
    });
    await remember(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "forum-baseline",
      resultId: intent.id,
    });
    await audit(tx, actor, {
      action: "forum.baseline_requested",
      entityId: input.environmentId,
      requestId: input.requestId,
      metadata: {
        reason: input.reason,
        snapshotFingerprint: context.snapshotFingerprint,
      },
    });
    return ForumBaselineIntentSchema.parse(wire(intent));
  });
}

export async function forumBaseline(
  this: Delivery,
  intentId: string,
  actor: Principal,
) {
  requireScope(actor, "read");
  const intent = ForumBaselineIntentSchema.parse(
    wire(
      required(
        await this.database.forumBaselineIntent.findUnique({
          where: { id: intentId },
        }),
        "Forum baseline",
      ),
    ),
  );
  return ForumBaselineContextSchema.parse({
    intent,
    environment: await environment(this.database, intent.environmentId),
    pipeline: PipelineRevisionSchema.parse(
      wire(
        required(
          await this.database.pipeline.findUnique({
            where: { id: intent.pipelineRevisionId },
          }),
          "Frozen forum pipeline",
        ),
      ),
    ),
    image: await artifact(this.database, intent.imageArtifactId),
    bundle: await artifact(this.database, intent.bundleArtifactId),
  });
}

export async function pendingForumBaselines(this: Delivery, actor: Principal) {
  requireScope(actor, "execute");
  const rows = await this.database.forumBaselineIntent.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return {
    intents: rows.map((row) => ForumBaselineIntentSchema.parse(wire(row))),
  };
}

export async function submittedForumBaseline(
  this: Delivery,
  intentId: string,
  workflowId: string,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const row = required(
    await this.database.forumBaselineIntent.findUnique({
      where: { id: intentId },
    }),
    "Forum baseline",
  );
  if (row.workflowId !== workflowId)
    throw new DeliveryError(
      "CONFLICT",
      "Forum baseline submission differs from its pending immutable Workflow",
    );
  if (row.status !== "pending")
    return ForumBaselineIntentSchema.parse(wire(row));
  return ForumBaselineIntentSchema.parse(
    wire(
      await this.database.forumBaselineIntent.update({
        where: { id: intentId },
        data: { submittedAt: row.submittedAt ?? new Date() },
      }),
    ),
  );
}
