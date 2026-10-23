import { Context } from "@temporalio/activity";
import { z } from "zod";
import type {
  DeploymentDetail,
  EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { deliveryOperationId } from "@shepherdjerred/delivery/operation-id";
import {
  forumReleaseOf,
  helmSource,
  helmValues,
} from "@shepherdjerred/delivery/model-contract";
import type { DeliverySelection } from "homelab/scripts/argocd/argocd-delivery.ts";
import { getArgoApplication } from "#lib/delivery/argo-client.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { forumReleaseId, forumReleaseParameters } from "#lib/delivery/forum.ts";
import { forumSyncPrunes } from "#lib/delivery/forum-prune.ts";
import {
  renderApplication,
  renderConfiguration,
  selectionArtifacts,
} from "#lib/delivery/model/application.ts";
import { applicationProgress } from "#lib/delivery/model/application-proof.ts";
import type { KubernetesApplicationRecipe } from "#lib/delivery/model/recipe.ts";
import {
  deploymentPath,
  recordStage,
  requireOwned,
  stageOf,
} from "./stages.ts";

const READBACK_ATTEMPTS = 120;
const READBACK_INTERVAL_MS = 5000;

const ResourcesSchema = z.object({
  status: z
    .object({
      resources: z
        .array(
          z
            .object({
              group: z.string().optional(),
              kind: z.string(),
              namespace: z.string().optional(),
              name: z.string(),
              status: z.string().optional(),
              health: z
                .object({
                  status: z.string(),
                  message: z.string().optional(),
                })
                .optional(),
            })
            .loose(),
        )
        .default([]),
    })
    .loose()
    .default({ resources: [] }),
});

export type ForumBundleEffects = {
  read: (name: string) => Promise<unknown>;
  owned: typeof requireOwned;
  record: typeof recordStage;
  wait: (milliseconds: number) => Promise<void>;
  heartbeat: (details: unknown) => void;
};
function liveEffects(): ForumBundleEffects {
  const context = Context.current();
  return {
    read: async (name) =>
      await getArgoApplication(name, { signal: context.cancellationSignal }),
    owned: requireOwned,
    record: recordStage,
    wait: async (milliseconds) => {
      await Bun.sleep(milliseconds);
    },
    heartbeat: (details) => {
      context.heartbeat(details);
    },
  };
}

/**
 * The first upgrade from an observed original baseline re-observes it
 * immediately before the apply-safety step writes the candidate source,
 * while the live Application still carries the original source the
 * baseline fingerprinted (as v1 checked before selecting the release).
 * Later upgrades migrate from the accepted selection and have no baseline.
 */
export async function forumBaselineFence(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
) {
  // Only the forum's own Application replaces the baselined source.
  if (
    forumReleaseOf(recipe) === undefined ||
    current.deployment.forumBaselineSnapshot === null
  )
    return;
  await deliveryRequest(
    `${deploymentPath(current.deployment.id)}/forum-baseline-check`,
    z.object({ verified: z.literal(true) }),
    {},
  );
}

/**
 * The v1 selection a forum Application rendered from its recipe is, so the
 * sync reuses `forumSyncPrunes` unchanged: the selection's patch over the
 * written Application reproduces its source exactly, Helm values
 * included. Null when the recipe has no forum-bundle step.
 */
export function forumPruneSelection(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
): DeliverySelection | null {
  if (forumReleaseOf(recipe) === undefined) return null;
  const rendered = renderApplication(current, recipe);
  const source = helmSource(recipe.application.source);
  if (source === null)
    throw new Error("A forum release syncs a Helm chart source");
  return {
    application: rendered.name,
    environmentId: rendered.environmentId,
    repository: source.repoURL,
    chart: source.chart,
    revision: rendered.revision,
    namespace: recipe.application.destination.namespace,
    parameters: helmValues(
      recipe,
      renderConfiguration(current, recipe),
      selectionArtifacts(current),
    ).parameters,
  };
}

/**
 * Whether the forum's sync prunes. Each release creates a Job named by its
 * deployment, so the prior release's Job leaves the new render. Pruning
 * removes only a prior terminal migration Job of this exact scope, after
 * re-reading the Application to confirm its source and incarnation are
 * still what the apply-safety step wrote (`forumSyncPrunes`).
 */
export async function forumSyncPrune(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  read: (path: string) => Promise<unknown>,
): Promise<boolean> {
  const selection = forumPruneSelection(current, recipe);
  return selection === null ? false : await forumSyncPrunes(selection, read);
}

type ReleaseJob = { state: "running" } | { state: "complete" };

function releaseJob(raw: unknown, namespace: string, name: string): ReleaseJob {
  const job = ResourcesSchema.parse(raw).status.resources.find(
    (resource) =>
      resource.group === "batch" &&
      resource.kind === "Job" &&
      resource.namespace === namespace &&
      resource.name === name,
  );
  if (job === undefined)
    throw new Error(
      `Release Job ${namespace}/${name} is not part of the synced Application; retain ownership`,
    );
  const health = job.health?.status;
  if (health === "Degraded" || health === "Missing")
    throw new Error(
      `Release Job ${namespace}/${name} is ${health}: ${job.health?.message ?? "no message"}; inspect the migration before releasing ownership`,
    );
  return health === "Healthy" && job.status === "Synced"
    ? { state: "complete" }
    : { state: "running" };
}

/**
 * The forum-bundle step, a point of no return: the sync step applied the
 * frozen release inputs, so the chart's release Job named by this
 * deployment verified the licensed bundle against its digest before
 * migrating the forum. This step records intent, then proves by readback
 * that the owned Application still carries exactly the rendered source
 * binding the frozen bundle digest and that the deployment's release Job
 * completed. A migration that fails, or never settles, leaves this step's
 * intent recorded so recovery inspects it; nothing here repeats an effect.
 */
export async function runForumBundleStep(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  key: string,
  effects: ForumBundleEffects = liveEffects(),
): Promise<EvidenceInput[]> {
  const forum = forumReleaseOf(recipe);
  if (forum === undefined)
    throw new Error(
      `Recipe ${recipe.application.name} has no forum-bundle step`,
    );
  const bundle = current.versionSet.components[forum.bundleComponent];
  const inputs = forumReleaseParameters(current, recipe);
  if (bundle?.digest !== `sha256:${inputs["delivery.bundleSha256"] ?? ""}`)
    throw new Error(
      "Forum release inputs differ from the frozen licensed bundle digest",
    );
  const rendered = renderApplication(current, recipe);
  const namespace = recipe.application.destination.namespace;
  const job = `storm-forum-release-${forumReleaseId(current.deployment.id)}`;
  const operationId = deliveryOperationId(`${current.deployment.id}:${key}`);
  if (stageOf(current, key) === undefined)
    await effects.record(current, key, "running", {
      operationId,
      message: `Proving release Job ${namespace}/${job} migrated to bundle ${bundle.digest}`,
    });
  // The sync step's request identity (application-proof.ts).
  const requestId = deliveryOperationId(current.deployment.id);
  for (let attempt = 0; attempt < READBACK_ATTEMPTS; attempt++) {
    await effects.owned(current.deployment.id);
    const raw = await effects.read(rendered.name);
    if (raw === null)
      throw new Error(`Application ${rendered.name} disappeared after sync`);
    const progress = applicationProgress(raw, rendered, requestId);
    if (
      progress.settled &&
      releaseJob(raw, namespace, job).state === "complete"
    ) {
      const evidence: EvidenceInput[] = [
        {
          kind: "reconciliation",
          operationId,
          summary: `Owned operation ${progress.operationId} binds licensed bundle ${bundle.digest} (XenForo ${bundle.version}) at ${progress.revision}; release Job ${namespace}/${job} completed`,
        },
        {
          kind: "runtime",
          operationId,
          summary: `Release Job ${job} verified the bundle digest before migrating from bundle sha256:${inputs["delivery.previousBundleSha256"] ?? ""}`,
        },
      ];
      await effects.record(current, key, "succeeded", {
        operationId,
        evidence,
      });
      return evidence;
    }
    effects.heartbeat({ key, attempt });
    await effects.wait(READBACK_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for release Job ${namespace}/${job}; inspect the migration before releasing ownership`,
  );
}
