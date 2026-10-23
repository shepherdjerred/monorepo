import type {
  DeploymentDetail,
  EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { deliveryOperationId } from "@shepherdjerred/delivery/operation-id";
import type { StaticSiteStepPolicy } from "#lib/delivery/model/recipe.ts";
import {
  activateStaticSelection,
  LIVE_STATIC_SITE_IO,
  withStaticActivityRuntime,
  type StaticSiteIo,
  type StaticSiteRuntime,
} from "#activities/delivery/static-site.ts";
import { modelStaticSiteSelection } from "#activities/delivery/static-site-selection.ts";
import { recordStage, requireOwned } from "./stages.ts";

export type StaticSiteStepEffects = {
  io: StaticSiteIo;
  record: typeof recordStage;
  /** Proves the deployment still owns its environment before each bucket effect. */
  owned: (id: string) => Promise<unknown>;
  run: <T>(operation: (runtime: StaticSiteRuntime) => Promise<T>) => Promise<T>;
  owners?: Readonly<Record<string, string>>;
};
const LIVE: StaticSiteStepEffects = {
  io: LIVE_STATIC_SITE_IO,
  record: recordStage,
  owned: requireOwned,
  run: withStaticActivityRuntime,
};

/**
 * The static-site step (section 5), standalone or inside an Application
 * recipe: the frozen archive is fetched from `delivery-artifacts` by its
 * digest, synced to the recipe's bucket under an activation receipt naming
 * this deployment, the cache is purged, and bucket bytes, entrypoints and
 * the public receipt are read back against that digest. Every write
 * re-records the same intent first, which proves the step still owns the
 * deployment; the receipt decides whether the bucket already holds this
 * deployment, so the sync never runs for a proven activation.
 */
export async function runStaticSiteStep(
  current: DeploymentDetail,
  policy: StaticSiteStepPolicy,
  key: string,
  effects: StaticSiteStepEffects = LIVE,
): Promise<void> {
  const site = modelStaticSiteSelection(current, policy, effects.owners);
  const operationId = deliveryOperationId(`${current.deployment.id}:${key}`);
  const evidence = await effects.run(
    async (runtime) =>
      await activateStaticSelection(site, runtime, effects.io, async () => {
        // Every attempt, resumed ones included, re-proves ownership
        // immediately before each bucket sync, receipt write and cache purge,
        // so a write never rests on a proof taken before a long sync. The
        // server accepts the same running intent under the same operation
        // identity only from the executor that owns the deployment under a
        // live lease (D7), which a read cannot prove.
        await effects.owned(current.deployment.id);
        await effects.record(current, key, "running", {
          operationId,
          message: `Activating archive ${site.archive.digest} in bucket ${site.pipeline.bucket} under receipt ${current.deployment.id}`,
        });
      }),
  );
  const acceptance: EvidenceInput = {
    kind: "acceptance",
    operationId,
    summary: JSON.stringify({
      adapter: "static-site",
      archiveArtifactId: site.archive.id,
      archiveDigest: site.archive.digest,
      versionSetRevisionId: current.versionSet.id,
      bucket: site.pipeline.bucket,
    }),
  };
  await effects.record(current, key, "succeeded", {
    operationId,
    evidence: [...evidence, acceptance],
  });
}
