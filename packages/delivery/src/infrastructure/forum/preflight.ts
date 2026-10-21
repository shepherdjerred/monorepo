import type { Principal } from "#shared/contract.ts";
import { ForumBaselineContextSchema } from "#shared/contract.ts";
import type { ForumBaselineProof } from "#shared/forum-contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  fingerprint,
  required,
} from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import { forumBaseline } from "./baseline-requests.ts";
import type { InspectForumBaseline } from "./baseline-settlement.ts";
import { lockForumBaseline } from "./baseline-context.ts";

function identity(proof: ForumBaselineProof) {
  return {
    application: {
      name: proof.application.name,
      uid: proof.application.uid,
      source: proof.application.sourceFingerprint,
    },
    runtimeImage: proof.runtimeImage,
    imageArtifactId: proof.imageArtifactId,
    bundleArtifactId: proof.bundleArtifactId,
    bundleDigest: proof.bundleDigest,
    runtime: proof.runtime,
    storage: proof.storage.map(
      ({ resourceVersion: _version, ...claim }) => claim,
    ),
    pods: proof.pods.map(({ resourceVersion: _version, ...pod }) => pod),
    releaseJob: {
      uid: proof.releaseJob.uid,
      name: proof.releaseJob.name,
      specFingerprint: proof.releaseJob.specFingerprint,
      completedAt: proof.releaseJob.completedAt,
    },
  };
}

/** Reobserve original baseline immediately before first candidate source selection. No caller-supplied health can authorize migration. */
export async function verifyForumDeploymentBaseline(
  this: Delivery,
  deploymentId: string,
  actor: Principal,
  inspect: InspectForumBaseline,
) {
  requireScope(actor, "execute");
  const detail = await this.detail(deploymentId),
    snapshot = detail.deployment.forumBaselineSnapshot;
  if (snapshot === null || detail.previousAcceptedVersionSet !== null)
    throw new DeliveryError(
      "INVALID",
      "Independent original baseline check is only for the first forum upgrade",
    );
  const original = await forumBaseline.call(this, snapshot.intentId, actor);
  const context = ForumBaselineContextSchema.parse({
    ...original,
    environment: detail.environment,
    pipeline: detail.pipeline,
    image: snapshot.image,
    bundle: snapshot.bundle,
  });
  const proof = await inspect(context);
  if (
    fingerprint(identity(proof)) !== fingerprint(identity(snapshot.proof)) ||
    Date.parse(proof.observedAt) < Date.now() - 30_000
  )
    throw new DeliveryError(
      "CONFLICT",
      "Original forum changed since baseline; do not select candidate source",
    );
  await this.database.$transaction(async (tx) => {
    await lockForumBaseline(tx, detail.environment.id);
    const deployment = required(
        await tx.deployment.findUnique({ where: { id: deploymentId } }),
        "Forum deployment",
      ),
      environment = required(
        await tx.environment.findUnique({
          where: { id: deployment.environmentId },
        }),
        "Forum environment",
      ),
      held = await tx.targetLock.findFirst({ where: { deploymentId } });
    if (
      held === null ||
      deployment.status !== "running" ||
      deployment.cancelRequested ||
      environment.activeDeploymentId !== deploymentId ||
      environment.generation !== deployment.expectedGeneration ||
      fingerprint(deployment.forumBaselineSnapshot) !== fingerprint(snapshot) ||
      (await tx.stage.findFirst({
        where: { deploymentId, key: "reconcile" },
      })) !== null
    )
      throw new DeliveryError(
        "CONFLICT",
        "Forum baseline check lost its running source owner before candidate selection",
      );
    await audit(tx, actor, {
      action: "forum.baseline_rechecked",
      entityId: deploymentId,
      requestId: crypto.randomUUID(),
      metadata: { proof },
    });
  });
  return { verified: true as const };
}
