/**
 * What makes a Delivery artifact a v2 static-site publication.
 *
 * Under the v2 catalog a site archive is an immutable archive whose component
 * is `archive:<bucket>` and whose URI is that bucket's content-addressed
 * object, and each independently released site is its own Delivery service,
 * named after its bucket. v1's `site:<bucket>` archives are not v2 sites.
 */
import { staticArchiveUri } from "../static-site-publication.ts";

const SITE_COMPONENT = /^archive:(?<bucket>[a-z0-9][a-z0-9.-]{1,61}[a-z0-9])$/u;

export function isStaticSiteArtifact(artifact: {
  kind: string;
  component: string;
  uri: string;
  digest: string;
}): boolean {
  const bucket = SITE_COMPONENT.exec(artifact.component)?.groups?.["bucket"];
  return (
    artifact.kind === "archive" &&
    bucket !== undefined &&
    artifact.uri === staticArchiveUri(bucket, artifact.digest)
  );
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
