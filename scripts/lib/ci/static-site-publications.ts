/**
 * What makes a Delivery artifact a static-site publication.
 *
 * A site is recognised by its artifact alone: an immutable archive whose
 * component is `site:<bucket>`. Under the v2 catalog each independently
 * released site is its own Delivery service, named after its bucket.
 */

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
