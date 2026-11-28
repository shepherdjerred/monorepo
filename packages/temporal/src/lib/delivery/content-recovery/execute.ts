import { z } from "zod";
import {
  ContentRecoveryContextSchema,
  type ContentRecoveryContext,
  type ContentRecoveryOwnership,
} from "@shepherdjerred/delivery/contract";
import {
  forumReleaseOf,
  stepApplicationOf,
} from "@shepherdjerred/delivery/model-contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import {
  pauseDeliveryDispatch,
  pauseRecordedDeliveryDispatch,
  type BarrierEffects,
} from "#lib/delivery/platform/control-plane-barrier.ts";
import { ContentOperatorError, type ContentOperatorAction } from "./request.ts";

type PriorDeployment = NonNullable<ContentRecoveryContext["priorDeployment"]>;

export type ContentOperatorEffects = {
  paused: (context: ContentRecoveryContext) => Promise<void>;
  original: (context: ContentRecoveryContext) => Promise<void>;
  fence: (context: ContentRecoveryContext) => Promise<void>;
  barrier: (
    context: ContentRecoveryContext,
    checkpoint: BarrierEffects["checkpoint"],
    fence: () => Promise<void>,
  ) => BarrierEffects;
  ownership: (
    context: ContentRecoveryContext,
  ) => Promise<ContentRecoveryOwnership>;
  repair: (context: ContentRecoveryContext) => Promise<void>;
  inspect: (context: ContentRecoveryContext) => Promise<{ observedAt: string }>;
  inspectPrior: (
    context: ContentRecoveryContext,
    prior: PriorDeployment,
  ) => Promise<{ observedAt: string }>;
  restore: (context: ContentRecoveryContext) => Promise<void>;
};

function forumApplication(detail: PriorDeployment): string | undefined {
  const definition = detail.pipeline.definition;
  if (forumReleaseOf(definition) === undefined) return undefined;
  return definition.kind === "argocd"
    ? definition.application
    : stepApplicationOf(definition, "forum-bundle")?.name;
}

function requireFrozenForumPrior(context: ContentRecoveryContext) {
  const { intent, priorDeployment: prior, deployment } = context;
  if (intent.status !== "pending" || intent.targetKind !== "forum")
    throw new ContentOperatorError(
      "Prior inspection requires a pending Forum recovery intent",
    );
  const { deployment: failed, environment } = deployment;
  if (
    failed.id !== intent.deploymentId ||
    failed.status !== "failed" ||
    !failed.recoveryRequired ||
    environment.activeDeploymentId !== failed.id ||
    environment.generation !== intent.expectedEnvironmentGeneration
  )
    throw new ContentOperatorError(
      "Prior inspection requires the same quarantined Forum deployment and environment generation",
    );
  const fingerprint = context.expectedSettlements.prior;
  const application = forumApplication(deployment);
  if (
    prior === null ||
    fingerprint === undefined ||
    application === undefined ||
    forumApplication(prior) !== application ||
    prior.deployment.status !== "succeeded" ||
    prior.deployment.environmentId !== failed.environmentId ||
    prior.deployment.id !== failed.previousAcceptedDeploymentId ||
    prior.deployment.id !== environment.acceptedDeploymentId
  )
    throw new ContentOperatorError(
      "Prior inspection requires the exact frozen accepted Forum deployment and its settlement fingerprint",
    );
  return { prior, fingerprint };
}

/** One foreground operator invocation. Failed target repair keeps the original
 * result, immutable backup and producer quarantine intact. No automatic worker
 * or new credential capability is delegated by this command.
 */
export async function executeContentRecovery(
  id: string,
  action: ContentOperatorAction,
  effects: ContentOperatorEffects,
  api: typeof deliveryRequest = deliveryRequest,
) {
  const base = `content-recovery/${encodeURIComponent(id)}`;
  const load = async () => await api(base, ContentRecoveryContextSchema);
  let context = await load();
  const frozenPrior =
    action === "inspect-prior" ? requireFrozenForumPrior(context) : undefined;
  const originalSnapshot = context.intent.snapshotFingerprint;
  const samePrior = (current: ContentRecoveryContext) => {
    if (frozenPrior === undefined) return;
    const { prior, fingerprint } = requireFrozenForumPrior(current);
    if (
      current.intent.snapshotFingerprint !== originalSnapshot ||
      prior.deployment.id !== frozenPrior.prior.deployment.id ||
      fingerprint !== frozenPrior.fingerprint
    )
      throw new ContentOperatorError(
        "The frozen prior Forum release or content quarantine changed",
      );
    return prior;
  };
  await effects.paused(context);
  if (context.intent.status === "succeeded") {
    if (
      context.intent.dispatchBarrier !== null &&
      context.intent.barrierRestoredAt === null
    )
      await effects.restore(context);
    return { status: "settled", originalDeploymentResult: "unchanged" };
  }
  if (context.intent.status !== "pending")
    throw new Error("Content recovery intent is not pending");
  await effects.original(context);
  context = await load();
  samePrior(context);
  const fence = async () => {
    const current = await load();
    if (
      current.intent.status !== "pending" ||
      current.intent.snapshotFingerprint !== context.intent.snapshotFingerprint
    )
      throw new Error("Original content quarantine changed");
    samePrior(current);
    await effects.paused(current);
    await effects.fence(current);
  };
  await fence();
  const barrier = effects.barrier(
    context,
    async (journal) => {
      await api(`${base}/barrier`, z.unknown(), journal);
    },
    fence,
  );
  if (context.intent.dispatchBarrier === null)
    await pauseDeliveryDispatch(barrier);
  else
    await pauseRecordedDeliveryDispatch(
      barrier,
      context.intent.dispatchBarrier,
    );
  context = await load();
  if (action === "repair") await effects.repair(context);
  // A separate fresh readback is mandatory even when repair reported success.
  const inspection = await load();
  const prior = samePrior(inspection);
  const observed =
    prior === undefined
      ? await effects.inspect(inspection)
      : await effects.inspectPrior(inspection, prior);
  context = await load();
  samePrior(context);
  const ownership = await effects.ownership(context);
  const observedAt = Date.parse(observed.observedAt);
  const now = Date.now();
  if (
    !Number.isFinite(observedAt) ||
    now - observedAt > 60_000 ||
    observedAt > now + 5000
  )
    throw new Error(
      "Content readback expired before settlement; repeat independent inspection",
    );
  await api(`${base}/complete`, z.unknown(), {
    ...ownership,
    observedAt: observed.observedAt,
    settlement:
      frozenPrior === undefined
        ? { state: "desired", fingerprint: context.expectedSettlements.desired }
        : { state: "prior", fingerprint: frozenPrior.fingerprint },
    proofSummary:
      frozenPrior === undefined
        ? "Operator independently verified the original frozen content, actual native ownership and target bytes/runtime after every repair producer became terminal."
        : "Operator independently verified the exact frozen prior Forum deployment and its serving runtime after every recovery producer became terminal.",
  });
  await effects.restore(await load());
  return { status: "settled", originalDeploymentResult: "unchanged" };
}
