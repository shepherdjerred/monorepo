/** Shared by the CDK8s declaration and the credential-scoped release runtime. */
export const APPLICATION_RESOURCES_FINALIZER =
  "resources-finalizer.argocd.argoproj.io";
export const APPLICATION_LIFECYCLE_ANNOTATION =
  "ci.sjer.red/application-lifecycle";
/**
 * Set to `"true"` on the retained root Application, under transition
 * rendering only, to let the lifecycle policy admit its deletion once every
 * child is owned elsewhere. The children stay in place: they carry no
 * resources finalizer and are retained.
 */
export const ORPHAN_ROOT_ANNOTATION = "delivery.shepherdjerred.com/orphan-root";
export const REPOSITORY_CHART_URLS = new Set([
  "https://chartmuseum.tailnet-1a49.ts.net",
  "https://chartmuseum.sjer.red",
]);
