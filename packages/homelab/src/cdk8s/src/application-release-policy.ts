import { ApiObject, Chart, JsonPatch, type App } from "cdk8s";
import { z } from "zod";
import { releaseChartRevisions } from "./release-configuration.ts";

export const APPLICATION_RESOURCES_FINALIZER =
  "resources-finalizer.argocd.argoproj.io";
export const APPLICATION_LIFECYCLE_ANNOTATION =
  "ci.sjer.red/application-lifecycle";
export const MANAGED_APPLICATION_LABEL = "ci.sjer.red/managed-application";
export const ARGOCD_SYNC_WAVE_ANNOTATION = "argocd.argoproj.io/sync-wave";

export const APPLICATION_SYNC_WAVES = {
  admissionPolicy: "-30",
  admissionBinding: "-29",
  onePassword: "-20",
  onePasswordItem: "-19",
  provider: "-18",
  certificateIssuer: "-4",
  certificate: "-3",
  structural: "0",
  kueue: "1",
  dependentConfiguration: "2",
  buildkite: "3",
  leaf: "4",
} as const;

const RETAIN_APPLICATIONS = new Set(["apps", "argocd"]);
const PROVIDER_APPLICATIONS = new Set([
  "argocd",
  "cert-manager",
  "cloudflare-operator",
  "intel-device-plugin-operator",
  "nfd",
  "openebs",
  "postgres-operator",
  "prometheus",
  "tailscale",
  "velero",
]);
export const REPOSITORY_CHART_URLS = new Set([
  "https://chartmuseum.tailnet-1a49.ts.net",
  "https://chartmuseum.sjer.red",
]);

const ApplicationManifestSchema = z.object({
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    source: z.object({
      repoURL: z.string(),
      chart: z.string().optional(),
    }),
    syncPolicy: z
      .object({
        automated: z.unknown().optional(),
      })
      .optional(),
  }),
});

function applicationSyncWave(name: string): string {
  if (name === "apps") {
    return APPLICATION_SYNC_WAVES.structural;
  }
  if (name === "1password") {
    return APPLICATION_SYNC_WAVES.onePassword;
  }
  if (PROVIDER_APPLICATIONS.has(name)) {
    return APPLICATION_SYNC_WAVES.provider;
  }
  if (name === "kueue") {
    return APPLICATION_SYNC_WAVES.kueue;
  }
  if (name === "buildkite") {
    return APPLICATION_SYNC_WAVES.buildkite;
  }
  return APPLICATION_SYNC_WAVES.leaf;
}

function rootResourceSyncWave(resource: ApiObject): string {
  if (
    resource.kind === "MutatingAdmissionPolicy" ||
    resource.kind === "ValidatingAdmissionPolicy"
  ) {
    return APPLICATION_SYNC_WAVES.admissionPolicy;
  }
  if (
    resource.kind === "MutatingAdmissionPolicyBinding" ||
    resource.kind === "ValidatingAdmissionPolicyBinding"
  ) {
    return APPLICATION_SYNC_WAVES.admissionBinding;
  }
  if (resource.apiGroup === "onepassword.com") {
    return APPLICATION_SYNC_WAVES.onePasswordItem;
  }
  if (resource.apiGroup === "cert-manager.io") {
    return resource.kind === "Certificate"
      ? APPLICATION_SYNC_WAVES.certificate
      : APPLICATION_SYNC_WAVES.certificateIssuer;
  }
  if (
    resource.apiGroup === "kueue.x-k8s.io" ||
    resource.apiGroup === "monitoring.coreos.com" ||
    resource.apiGroup === "networking.cfargotunnel.com" ||
    (resource.apiGroup === "tailscale.com" && resource.kind === "ProxyClass")
  ) {
    return APPLICATION_SYNC_WAVES.dependentConfiguration;
  }
  return APPLICATION_SYNC_WAVES.structural;
}

function applyResourceReleasePolicy(
  construct: ApiObject,
  revisions: ReturnType<typeof releaseChartRevisions>,
  seenRepositoryCharts: Set<string>,
): void {
  const isRootChartResource = Chart.of(construct).node.id === "apps";
  const isApplication =
    construct.kind === "Application" && construct.apiGroup === "argoproj.io";
  if (!isApplication) {
    if (isRootChartResource) {
      construct.metadata.addAnnotation(
        ARGOCD_SYNC_WAVE_ANNOTATION,
        rootResourceSyncWave(construct),
      );
    }
    return;
  }
  const parsedManifest = ApplicationManifestSchema.safeParse(
    construct.toJson(),
  );
  if (!parsedManifest.success) {
    throw new Error(
      `Could not inspect Application ${construct.node.path}: ${z.prettifyError(parsedManifest.error)}`,
    );
  }
  const manifest = parsedManifest.data;
  const applicationName = manifest.metadata.name;
  if (isRootChartResource) {
    construct.metadata.addAnnotation(
      ARGOCD_SYNC_WAVE_ANNOTATION,
      applicationSyncWave(applicationName),
    );
  }
  if (applicationName !== "apps") {
    construct.metadata.addLabel(MANAGED_APPLICATION_LABEL, "true");
  }
  if (RETAIN_APPLICATIONS.has(applicationName)) {
    construct.metadata.addAnnotation(
      APPLICATION_LIFECYCLE_ANNOTATION,
      "retain",
    );
  } else {
    construct.metadata.addAnnotation(
      APPLICATION_LIFECYCLE_ANNOTATION,
      "cascade",
    );
    construct.metadata.addFinalizers(APPLICATION_RESOURCES_FINALIZER);
  }

  const chartName = manifest.spec.source.chart;
  const isRepositoryChart =
    chartName !== undefined &&
    REPOSITORY_CHART_URLS.has(manifest.spec.source.repoURL);
  if (
    isRepositoryChart &&
    manifest.spec.syncPolicy !== undefined &&
    Object.hasOwn(manifest.spec.syncPolicy, "automated")
  ) {
    construct.addJsonPatch(
      JsonPatch.replace("/spec/syncPolicy/automated", { enabled: false }),
    );
  }
  if (
    revisions === undefined ||
    chartName === undefined ||
    chartName === "apps" ||
    !isRepositoryChart
  ) {
    return;
  }
  const revision = revisions[chartName];
  if (revision === undefined) {
    throw new Error(
      `Release chart revision inventory is missing repository chart ${chartName}`,
    );
  }
  seenRepositoryCharts.add(chartName);
  construct.addJsonPatch(
    JsonPatch.replace("/spec/source/targetRevision", revision),
  );
}

export function applyApplicationReleasePolicy(app: App): void {
  const revisions = releaseChartRevisions();
  const seenRepositoryCharts = new Set<string>();
  for (const construct of app.node.findAll()) {
    if (ApiObject.isApiObject(construct)) {
      applyResourceReleasePolicy(construct, revisions, seenRepositoryCharts);
    }
  }
  if (revisions !== undefined) {
    const unused = Object.keys(revisions).filter(
      (chart) => !seenRepositoryCharts.has(chart),
    );
    if (unused.length > 0) {
      throw new Error(
        `Release chart revision inventory has unknown charts: ${unused.join(", ")}`,
      );
    }
  }
}
