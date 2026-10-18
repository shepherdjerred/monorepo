import { z } from "zod";
import {
  ContentRecoveryContextSchema,
  type ContentRecoveryContext,
  type ContentRecoveryOwnership,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import {
  pauseDeliveryDispatch,
  pauseRecordedDeliveryDispatch,
  type BarrierEffects,
} from "#lib/delivery/platform/control-plane-barrier.ts";
import type { ContentAction } from "./request.ts";

export type ContentOperatorEffects = {
  paused: () => Promise<void>;
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
  restore: (context: ContentRecoveryContext) => Promise<void>;
};

/** One foreground operator invocation. Failed target repair keeps the original
 * result, immutable backup and producer quarantine intact. No automatic worker
 * or new credential capability is delegated by this command.
 */
export async function executeContentRecovery(
  id: string,
  action: ContentAction,
  effects: ContentOperatorEffects,
  api: typeof deliveryRequest = deliveryRequest,
) {
  const base = `content-recovery/${encodeURIComponent(id)}`;
  const load = async () => await api(base, ContentRecoveryContextSchema);
  let context = await load();
  await effects.paused();
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
  const fence = async () => {
    const current = await load();
    if (
      current.intent.status !== "pending" ||
      current.intent.snapshotFingerprint !== context.intent.snapshotFingerprint
    )
      throw new Error("Original content quarantine changed");
    await effects.paused();
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
  const observed = await effects.inspect(await load());
  context = await load();
  const ownership = await effects.ownership(context);
  if (
    Date.now() - Date.parse(observed.observedAt) > 60_000 ||
    Date.parse(observed.observedAt) > Date.now() + 5000
  )
    throw new Error(
      "Content readback expired before settlement; repeat independent inspection",
    );
  await api(`${base}/complete`, z.unknown(), {
    ...ownership,
    observedAt: observed.observedAt,
    settlement: {
      state: "desired",
      fingerprint: context.expectedSettlements.desired,
    },
    proofSummary:
      "Operator independently verified the original frozen content, actual native ownership and target bytes/runtime after every repair producer became terminal.",
  });
  await effects.restore(await load());
  return { status: "settled", originalDeploymentResult: "unchanged" };
}
