/** Shared by the CDK8s declaration and the credential-scoped release runtime. */
export const APPLICATION_RESOURCES_FINALIZER =
  "resources-finalizer.argocd.argoproj.io";
export const APPLICATION_LIFECYCLE_ANNOTATION =
  "ci.sjer.red/application-lifecycle";
export const REPOSITORY_CHART_URLS = new Set([
  "https://chartmuseum.tailnet-1a49.ts.net",
  "https://chartmuseum.sjer.red",
]);
