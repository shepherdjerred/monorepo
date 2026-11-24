import { z } from "zod";
import { ApplicationFailure } from "@temporalio/common";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { effectSignal } from "#lib/delivery/model/effect-signal.ts";
import {
  SyncedArgoHistorySchema,
  latestArgoSyncedHistory,
} from "#lib/delivery/argocd-proof.ts";
import {
  deleteArgoApplication,
  getArgoApplication,
  updateArgoApplication,
} from "#lib/delivery/argo-client.ts";
import type { RenderedApplication } from "#lib/delivery/model/application.ts";
import type { KubernetesApplicationRecipe } from "#lib/delivery/model/recipe.ts";
import { argoRequest } from "#activities/delivery/argocd.ts";
import { credentialSyncPrunes } from "#lib/delivery/credential-prune.ts";
import { workerSyncPrunes } from "#lib/delivery/workers/worker-prune.ts";
import { alertDashboardSyncPrunes } from "#lib/delivery/alert-dashboard/prune.ts";
import { serviceProbesSyncPrunes } from "#lib/delivery/service-probes/prune.ts";
import { renderedRelease } from "#lib/delivery/retired-route-prune.ts";
import { recordStage } from "./stages.ts";
import { minecraftSyncFence } from "./minecraft-upgrade.ts";
import { forumSyncPrune } from "./forum-bundle.ts";

/** The Delivery API caps an evidence summary at 4000 chars. */
export const EVIDENCE_SUMMARY_LIMIT = 4000;

/** One Application step of a deployment, as apply-safety and sync record it. */
export type ApplicationStep = {
  current: DeploymentDetail;
  rendered: RenderedApplication;
  key: string;
  operationId: string;
};

async function readCandidateApplication(rendered: RenderedApplication) {
  return await getArgoApplication(rendered.name, {
    signal: effectSignal(),
    project: rendered.body.spec.project,
  });
}

/**
 * Undoes the apply-safety step's only effect, the body it wrote: a created
 * Application is removed without touching resources (nothing was synced), and
 * an updated one gets back the source Argo last synced. Automation stays off;
 * the next release writes its own body. Resolves what was done.
 */
export async function restoreWrittenBody(
  rendered: RenderedApplication,
  written: "created" | "updated",
): Promise<string> {
  if (written === "created") {
    await deleteArgoApplication(
      rendered.name,
      { environmentId: rendered.environmentId, cascade: false },
      { signal: effectSignal() },
    );
    return "removed the Application it had created";
  }
  const current = SyncedArgoHistorySchema.parse(
    await readCandidateApplication(rendered),
  );
  const latest = latestArgoSyncedHistory(current.status?.history);
  if (latest === null)
    throw new Error(
      `Application ${rendered.name} has no synced source to restore`,
    );
  await updateArgoApplication(
    rendered.name,
    {
      ...rendered.body,
      metadata: {
        ...rendered.body.metadata,
        resourceVersion: current.metadata.resourceVersion,
      },
      spec: { ...rendered.body.spec, source: latest.source },
    },
    { environmentId: rendered.environmentId },
    { signal: effectSignal() },
  );
  return `restored the source Argo last synced (history ${latest.id.toString()})`;
}

/**
 * The sync step's pre-sync guards: fences that refuse an unsafe sync and the
 * prune decisions that keep it to the resources a release may remove. Every
 * one only reads; none submits an Argo operation.
 */
export async function syncPruneDecision(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  rendered: RenderedApplication,
) {
  // A preserved world switches images only with fresh preservation proof.
  minecraftSyncFence(current, recipe);
  // A forum release replaces the prior release's terminal migration Job;
  // Hub's release removes its retired alerts and ops Ingresses; service-probes
  // removes retired Probe CRs; a worker release removes the hosts earlier
  // retirements scaled to zero.
  const applicationPrune = (await forumSyncPrune(current, recipe, argoRequest))
    ? true
    : await credentialSyncPrunes(
        {
          ...rendered,
          namespace: rendered.body.spec.destination.namespace,
        },
        argoRequest,
      );
  if (applicationPrune !== false) return applicationPrune;
  const release = renderedRelease(rendered);
  return (
    (await alertDashboardSyncPrunes(release, argoRequest)) ||
    (await serviceProbesSyncPrunes(release, argoRequest)) ||
    (await workerSyncPrunes(current, rendered, argoRequest))
  );
}

const NeverRequestedSchema = z.object({
  operation: z.null().optional(),
  status: z
    .object({
      operationState: z
        .object({
          phase: z.string(),
          operation: z.object({
            info: z
              .array(z.object({ name: z.string(), value: z.string() }))
              .default([]),
          }),
        })
        .optional(),
      history: z
        .array(
          z.object({
            id: z.number(),
            source: z.record(z.string(), z.unknown()),
          }),
        )
        .optional(),
    })
    .optional(),
});

/**
 * Reads the Application back after a pre-sync guard refused and proves the
 * step's request never reached Argo: no operation is pending, the recorded
 * operation is quiescent and carries another request, so the only effect
 * left is the body apply-safety wrote. Null when that cannot be proven.
 */
async function proveNeverRequested(
  rendered: RenderedApplication,
  requestId: string,
): Promise<{ written: "updated"; summary: string } | null> {
  let raw: unknown;
  try {
    raw = await readCandidateApplication(rendered);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const parsed = NeverRequestedSchema.safeParse(raw);
  if (!parsed.success) return null;
  const state = parsed.data.status?.operationState;
  if (state !== undefined) {
    if (["Running", "Terminating"].includes(state.phase)) return null;
    const requests = state.operation.info.filter(
      (entry) => entry.name === "ci.sjer.red/request-id",
    );
    if (requests.some((entry) => entry.value === requestId)) return null;
  }
  // Without a synced history entry the step cannot tell a body apply-safety
  // created from one it replaced, so nothing is undone and recovery decides.
  const latest = latestArgoSyncedHistory(parsed.data.status?.history);
  if (latest === null) return null;
  const last =
    state === undefined
      ? "no recorded operation"
      : `last operation ${state.phase} for another request`;
  return {
    written: "updated",
    summary: `no operation pending and ${last}; history ${latest.id.toString()} is the last synced source`,
  };
}

/**
 * A pre-sync guard refused before any Argo operation (AI-884, D5, I2): read
 * back that the step's request never reached the Application, undo the body
 * apply-safety wrote, and settle the stage failed so the deployment ends
 * without recovery. If either proof or undo fails, the stage stays running
 * and the deployment ends recovery-required as before.
 */
export async function settleRefusedSyncGuard(
  step: ApplicationStep,
  error: unknown,
): Promise<never> {
  const { current, rendered, key, operationId } = step;
  const unrequested = await proveNeverRequested(rendered, operationId);
  if (unrequested === null) throw error;
  const undone = await restoreWrittenBody(rendered, unrequested.written).catch(
    () => {
      throw error;
    },
  );
  const reason =
    error instanceof Error ? error.message : "a pre-sync guard refused";
  const summary = `Sync of ${rendered.name} at ${rendered.revision} refused before any operation: request ${operationId} never reached Argo (${unrequested.summary}); ${undone}. ${reason}`;
  await recordStage(current, key, "failed", {
    operationId,
    message: `${key}: refused before any operation; ${undone}`,
    evidence: [
      {
        kind: "preflight",
        operationId,
        summary: summary.slice(0, EVIDENCE_SUMMARY_LIMIT),
      },
    ],
  });
  throw ApplicationFailure.nonRetryable(
    `Sync guard refused ${rendered.name}; ${undone}, and nothing was synced: ${reason}`,
    "DeliverySyncGuardRefused",
  );
}
