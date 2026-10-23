import type {
  DeploymentDetail,
  StaticSitePolicy,
} from "@shepherdjerred/delivery/contract";
import {
  assertStaticSiteDeliveryOwner,
  staticSiteDeliveryOwner,
} from "homelab/src/static-site-delivery-ownership.ts";
import { catalogEnvironmentOf } from "@shepherdjerred/ops-model/delivery-catalog/migration.ts";
import { staticArchivePath } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";
import { validateStaticArchiveUri } from "@shepherdjerred/root-scripts/lib/static-site-publication.ts";
import type { StaticActivationReceipt } from "./static-site-effects.ts";

type SelectionDetail = {
  pipeline: Pick<DeploymentDetail["pipeline"], "definition">;
  environment: Pick<DeploymentDetail["environment"], "id">;
  versionSet: Pick<DeploymentDetail["versionSet"], "id" | "components">;
  deployment: Pick<DeploymentDetail["deployment"], "id" | "kind">;
};
type SitePolicy = StaticSitePolicy & { kind: "static-site" };

/** Scout's frontend is a stage of its backend release, with the same lock and set. */
export function staticSiteSelection(
  detail: SelectionDetail,
  owners?: Readonly<Record<string, string>>,
) {
  const definition = detail.pipeline.definition;
  const pipeline =
    definition.kind === "static-site"
      ? definition
      : definition.kind === "argocd" && definition.scoutSite !== undefined
        ? { kind: "static-site" as const, ...definition.scoutSite }
        : null;
  if (pipeline === null)
    throw new Error("Expected a static-site release policy");
  assertStaticSiteDeliveryOwner(pipeline.bucket, detail.environment.id, owners);
  return selectedSite(detail, pipeline);
}

/**
 * A model recipe or step names its bucket as its lock instance, and the
 * deployment holds its lock (T1). Reviewed infrastructure must still
 * delegate the bucket to exactly this environment: the catalog's instance
 * binding is not correlated with that reviewed ownership. The reviewed map
 * names v1 environment ids, so its owner is compared under the catalog
 * identity the cutover gives it (section 7).
 */
export function modelStaticSiteSelection(
  detail: SelectionDetail,
  policy: StaticSitePolicy,
  owners?: Readonly<Record<string, string>>,
) {
  const owner = staticSiteDeliveryOwner(policy.bucket, owners);
  if (owner === undefined)
    throw new Error(
      `Static bucket ${policy.bucket} is not delegated to Delivery in reviewed infrastructure`,
    );
  const environment = catalogEnvironmentOf(owner);
  if (environment !== detail.environment.id)
    throw new Error(
      `Static bucket ${policy.bucket} is delegated to ${environment}, not ${detail.environment.id}, in reviewed infrastructure`,
    );
  return selectedSite(detail, { kind: "static-site", ...policy });
}

export type StaticSiteSelection = ReturnType<typeof selectedSite>;

function selectedSite(detail: SelectionDetail, pipeline: SitePolicy) {
  if (
    detail.deployment.kind === "adopt-worker" ||
    detail.deployment.kind === "retire-host"
  )
    throw new Error(
      "Worker lifecycle operations cannot activate frontend archives",
    );
  const archive = detail.versionSet.components[pipeline.archiveComponent];
  if (archive?.kind !== "archive")
    throw new Error("Selected static-site archive is missing");
  validateStaticArchiveUri(archive.uri, archive.digest);
  for (const prefix of pipeline.immutablePrefixes) {
    if (!prefix.endsWith("/"))
      throw new Error("Static immutable prefixes must end in a slash");
    staticArchivePath(prefix.slice(0, -1));
  }
  for (const entrypoint of pipeline.entrypoints) staticArchivePath(entrypoint);
  const receipt: StaticActivationReceipt = {
    deploymentId: detail.deployment.id,
    versionSetRevisionId: detail.versionSet.id,
    archiveDigest: archive.digest,
    bucket: pipeline.bucket,
  };
  return { pipeline, archive, receipt };
}
