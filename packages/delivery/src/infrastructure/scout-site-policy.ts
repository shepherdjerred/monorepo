import { DeliveryError } from "#domain/error.ts";
import type {
  PipelineDefinition,
  RegisterEnvironment,
  StoredRecipeDefinition,
  VersionSetRevision,
} from "#shared/contract.ts";
import { siteReleaseOf } from "#shared/model/recipe-view.ts";

export function validateScoutSitePipeline(pipeline: PipelineDefinition) {
  if (pipeline.kind !== "argocd" || pipeline.scoutSite === undefined) return;
  const stage = pipeline.application === "scout-beta" ? "beta" : "prod";
  const bucket = stage === "beta" ? "scout-frontend-beta" : "scout-frontend";
  if (
    !["scout-beta", "scout-prod"].includes(pipeline.application) ||
    pipeline.namespace !== pipeline.application ||
    pipeline.workerRollout?.target !== pipeline.application ||
    pipeline.workerRollout.imageComponent !== "image:scout-for-lol" ||
    pipeline.scoutSite.bucket !== bucket ||
    pipeline.scoutSite.archiveComponent !== `site:${bucket}`
  )
    throw new DeliveryError(
      "INVALID",
      "Combined Scout releases require their fixed backend application, worker profile and matching frontend archive flavor",
    );
}

export function validateScoutSiteEnvironment(
  input: RegisterEnvironment,
  pipeline: PipelineDefinition,
) {
  if (pipeline.kind !== "argocd" || pipeline.scoutSite === undefined) return;
  const stage = pipeline.application === "scout-beta" ? "beta" : "prod";
  if (
    input.serviceId !== "scout-for-lol" ||
    input.id !== `scout-for-lol/${stage}` ||
    input.application !== pipeline.application
  )
    throw new DeliveryError(
      "INVALID",
      "Combined Scout frontend and backend share the canonical beta or production environment",
    );
}

export function validateScoutSiteSelection(
  pipeline: StoredRecipeDefinition,
  version: VersionSetRevision,
) {
  if (pipeline.kind === "static-site" && version.serviceId === "scout-for-lol")
    throw new DeliveryError(
      "INVALID",
      "Scout frontend activation requires the combined backend release lock",
    );
  const site = siteReleaseOf(pipeline);
  if (site === undefined) return;
  const archive = version.components[site.archiveComponent];
  const image = version.components["image:scout-for-lol"];
  if (
    archive?.kind !== "archive" ||
    image?.kind !== "image" ||
    archive.requires["image:scout-for-lol"] !== image.digest
  )
    throw new DeliveryError(
      "INVALID",
      "Scout frontend archive must require the exact selected backend image digest",
    );
}
