import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { assertStaticSiteDeliveryOwner } from "homelab/src/static-site-delivery-ownership.ts";
import { staticArchivePath } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";
import { validateStaticArchiveUri } from "@shepherdjerred/root-scripts/lib/static-site-publication.ts";
import type { StaticActivationReceipt } from "./static-site-effects.ts";

type SelectionDetail = {
  pipeline: Pick<DeploymentDetail["pipeline"], "definition">;
  environment: Pick<DeploymentDetail["environment"], "id">;
  versionSet: Pick<DeploymentDetail["versionSet"], "id" | "components">;
  deployment: Pick<DeploymentDetail["deployment"], "id" | "kind">;
};

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
  if (
    detail.deployment.kind === "adopt-worker" ||
    detail.deployment.kind === "retire-host"
  )
    throw new Error(
      "Worker lifecycle operations cannot activate frontend archives",
    );
  assertStaticSiteDeliveryOwner(pipeline.bucket, detail.environment.id, owners);
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
