import { ForumBaselineContextSchema } from "#shared/contract.ts";
import type { Principal, ForumBaselineContext } from "#shared/contract.ts";
import {
  CompleteForumBaselineSchema,
  FailForumBaselineSchema,
  ForumBaselineIntentSchema,
  ForumBaselineProofSchema,
} from "#shared/forum-contract.ts";
import type {
  CompleteForumBaseline,
  ForumBaselineProof,
} from "#shared/forum-contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import { forumBaseline } from "./baseline-requests.ts";
import { forumBaselineInputs, lockForumBaseline } from "./baseline-context.ts";

export type InspectForumBaseline = (
  context: ForumBaselineContext,
) => Promise<ForumBaselineProof>;
function validateProof(context: ForumBaselineContext, raw: ForumBaselineProof) {
  const proof = ForumBaselineProofSchema.parse(raw),
    { image, bundle, intent, pipeline } = context;
  if (
    pipeline.definition.kind !== "argocd" ||
    proof.environmentId !== intent.environmentId ||
    proof.application.name !== pipeline.definition.application ||
    proof.imageArtifactId !== image.id ||
    proof.bundleArtifactId !== bundle.id ||
    proof.bundleDigest !== bundle.digest ||
    proof.runtimeImage !== `${image.uri}@${image.digest}` ||
    `sha256:${proof.runtime.bundleSha256}` !== bundle.digest ||
    proof.runtime.xenforoVersion !== bundle.version ||
    Date.parse(proof.observedAt) < Date.now() - 30_000 ||
    Date.parse(proof.observedAt) > Date.now() + 5000
  )
    throw new DeliveryError(
      "CONFLICT",
      "Independent forum baseline does not match its exact original artifacts, source or freshness",
    );
  if (
    proof.pods.some(
      (pod) =>
        !image.runtimeDigests.some(
          (digest) => pod.imageId === `${image.uri}@${digest}`,
        ),
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum baseline Pod runtime digest is not one of the original qualified platform images",
    );
  return proof;
}

export async function completeForumBaseline(
  this: Delivery,
  ...args: [
    intentId: string,
    input: CompleteForumBaseline,
    actor: Principal,
    inspect: InspectForumBaseline,
  ]
) {
  const [intentId, rawInput, actor, inspect] = args;
  requireScope(actor, "execute");
  const input = CompleteForumBaselineSchema.parse(rawInput),
    context = ForumBaselineContextSchema.parse(
      await forumBaseline.call(this, intentId, actor),
    ),
    resultFingerprint = fingerprint(input);
  if (context.intent.status !== "pending") {
    const terminal = required(
      await this.database.forumBaselineIntent.findUnique({
        where: { id: intentId },
      }),
      "Forum baseline",
    );
    if (
      terminal.status !== "succeeded" ||
      terminal.resultFingerprint !== resultFingerprint
    )
      throw new DeliveryError("CONFLICT", "Forum baseline result is immutable");
    return context.intent;
  }
  const proof = validateProof(context, await inspect(context));
  return this.database.$transaction(async (tx) => {
    await lock(tx, `forum-baseline:${intentId}`);
    const intent = required(
      await tx.forumBaselineIntent.findUnique({ where: { id: intentId } }),
      "Forum baseline",
    );
    await lockForumBaseline(tx, intent.environmentId);
    const current = await forumBaselineInputs(tx, intent);
    if (
      intent.status !== "pending" ||
      current.snapshotFingerprint !== intent.snapshotFingerprint ||
      input.snapshotFingerprint !== intent.snapshotFingerprint ||
      input.expectedEnvironmentGeneration !==
        intent.expectedEnvironmentGeneration ||
      Date.parse(proof.observedAt) < Date.now() - 30_000
    )
      throw new DeliveryError(
        "CONFLICT",
        "Forum baseline lost its exact original source, generation or fresh native observation",
      );
    const updated = await tx.forumBaselineIntent.update({
      where: { id: intentId },
      data: {
        status: "succeeded",
        proof,
        resultFingerprint,
        finishedAt: new Date(),
        message:
          "Read-only original runtime, installed XenForo, bundle and completed release Job independently observed; no deployment accepted",
      },
    });
    await tx.environment.update({
      where: { id: intent.environmentId },
      data: {
        acceptedForumBaselineIntentId: intent.id,
        generation: { increment: 1 },
      },
    });
    await audit(tx, actor, {
      action: "forum.baseline_completed",
      entityId: intent.environmentId,
      requestId: intent.id,
      metadata: { proof, snapshotFingerprint: intent.snapshotFingerprint },
    });
    return ForumBaselineIntentSchema.parse(wire(updated));
  });
}

export async function failForumBaseline(
  this: Delivery,
  intentId: string,
  message: string,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = FailForumBaselineSchema.parse({ message });
  return this.database.$transaction(async (tx) => {
    await lock(tx, `forum-baseline:${intentId}`);
    const intent = required(
      await tx.forumBaselineIntent.findUnique({ where: { id: intentId } }),
      "Forum baseline",
    );
    if (intent.status !== "pending") {
      if (
        intent.status !== "failed" ||
        intent.resultFingerprint !== fingerprint(input)
      )
        throw new DeliveryError(
          "CONFLICT",
          "Forum baseline result is immutable",
        );
      return ForumBaselineIntentSchema.parse(wire(intent));
    }
    const updated = await tx.forumBaselineIntent.update({
      where: { id: intentId },
      data: {
        status: "failed",
        message: input.message,
        resultFingerprint: fingerprint(input),
        finishedAt: new Date(),
      },
    });
    await audit(tx, actor, {
      action: "forum.baseline_failed",
      entityId: intent.environmentId,
      requestId: intent.id,
      metadata: input,
    });
    return ForumBaselineIntentSchema.parse(wire(updated));
  });
}
