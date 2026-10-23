/**
 * What makes a Delivery artifact a static-site publication.
 *
 * A site is recognised by its artifact alone: an immutable archive whose
 * component is `site:<bucket>`. Each independently released site is its own
 * Delivery service, named after its bucket, and activates in the environment
 * the reviewed destination map assigns to that bucket. No service name is
 * hard-coded anywhere on this path.
 */
import type { Catalog } from "@shepherdjerred/ops-model/catalog.ts";
import { STATIC_SITE_DESTINATIONS } from "@shepherdjerred/ops-model/static-release-targets.ts";

const SITE_COMPONENT = /^site:(?<bucket>[a-z0-9][a-z0-9.-]{1,61}[a-z0-9])$/u;

export function isStaticSiteArtifact(artifact: {
  kind: string;
  component: string;
}): boolean {
  return artifact.kind === "archive" && SITE_COMPONENT.test(artifact.component);
}

export function staticSiteBucket(component: string): string {
  const bucket = SITE_COMPONENT.exec(component)?.groups?.["bucket"];
  if (bucket === undefined)
    throw new Error(`Not a static site component: ${component}`);
  return bucket;
}

/** Each independent site is the Delivery service named after its bucket. */
export function staticSiteServiceId(bucket: string): string {
  return bucket;
}

/** The reviewed activation environment of a bucket; an unknown bucket has no release path. */
export function staticSiteEnvironment(bucket: string): string {
  const environmentId = STATIC_SITE_DESTINATIONS[bucket];
  if (environmentId === undefined)
    throw new Error(
      "Independent static publication requires its reviewed bucket owner",
    );
  return environmentId;
}

export function catalogOwnsService(
  catalog: Catalog,
  serviceId: string,
): boolean {
  return catalog.services.some((service) => service.id === serviceId);
}

/**
 * Buckets that release on their own: those whose service the catalog owns.
 * A bucket that rides a combined deployment (Scout's frontends publish under
 * the Scout service) has no service of its own and is excluded.
 */
export function independentStaticSites(
  catalog: Catalog,
): readonly { bucket: string; serviceId: string; environmentId: string }[] {
  return Object.entries(STATIC_SITE_DESTINATIONS)
    .map(([bucket, environmentId]) => ({
      bucket,
      serviceId: staticSiteServiceId(bucket),
      environmentId,
    }))
    .filter((site) => catalogOwnsService(catalog, site.serviceId));
}
