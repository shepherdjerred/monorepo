import { ApiObject, Chart, JsonPatch, type App } from "cdk8s";
import { z } from "zod";
import {
  releaseChartRevisions,
  transitionRendering,
} from "./release-configuration.ts";
import { BURST_SERVICE_PRIORITY } from "./misc/priority-classes.ts";
import {
  BASELINE_CHARTS,
  ROOT_CHART,
} from "./resources/cluster-baseline/charts.ts";
import { COMPANION_CHARTS } from "./resources/companions/names.ts";
import {
  deliveryEnvironment,
  DELIVERY_ACTIVE_DELEGATIONS,
  DELIVERY_ENVIRONMENT_ANNOTATION,
} from "homelab/src/delivery-ownership.ts";

import * as releaseContract from "homelab/src/application-release-contract.ts";
import { catalogApplicationEnvironment } from "@shepherdjerred/ops-model/delivery-catalog/applications.ts";
export const APPLICATION_RESOURCES_FINALIZER =
  releaseContract.APPLICATION_RESOURCES_FINALIZER;
export const APPLICATION_LIFECYCLE_ANNOTATION =
  releaseContract.APPLICATION_LIFECYCLE_ANNOTATION;
export const REPOSITORY_CHART_URLS = releaseContract.REPOSITORY_CHART_URLS;
export const ORPHAN_ROOT_ANNOTATION = releaseContract.ORPHAN_ROOT_ANNOTATION;
export const MANAGED_APPLICATION_LABEL = "ci.sjer.red/managed-application";
export const ARGOCD_SYNC_WAVE_ANNOTATION = "argocd.argoproj.io/sync-wave";
export const ARGOCD_SYNC_OPTIONS_ANNOTATION = "argocd.argoproj.io/sync-options";

export const APPLICATION_SYNC_WAVES = {
  // Under transition rendering, AppProjects must exist before any
  // Application that names them syncs.
  appProject: "-31",
  admissionPolicy: "-30",
  admissionBinding: "-29",
  onePassword: "-20",
  onePasswordItem: "-19",
  provider: "-18",
  certificateIssuer: "-5",
  certificateAuthority: "-4",
  clusterIssuer: "-3",
  certificate: "-2",
  // After the cluster CA so Alertmanager can require postal-smtp-ca.
  prometheus: "-1",
  // Accept the current ops snapshot contract before Activity workers emit it.
  opsSnapshotConsumer: "-1",
  burstPriorityClass: "-1",
  temporal: "0",
  structural: "0",
  kueue: "1",
  dependentConfiguration: "2",
  woodpecker: "3",
  leaf: "4",
  // Legacy game charts must release fixed edge ports and aliases before Arcade.
  arcade: "5",
} as const;

const RETAIN_APPLICATIONS = new Set(["apps", "argocd"]);
const PROVIDER_APPLICATIONS = new Set([
  "argocd",
  "cert-manager",
  "cloudflare-operator",
  "flipt",
  "intel-device-plugin-operator",
  "nfd",
  "openebs",
  "postgres-operator",
  "tailscale",
  "velero",
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

const CertificateManifestSchema = z.object({
  spec: z
    .object({
      isCA: z.boolean().optional(),
    })
    .optional(),
});

function certificateIsCa(resource: ApiObject): boolean {
  const parsed = CertificateManifestSchema.safeParse(resource.toJson());
  if (!parsed.success) {
    throw new Error(
      `Could not inspect Certificate ${resource.node.path}: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data.spec?.isCA === true;
}

function applicationSyncWave(name: string): string {
  if (name === "apps") {
    // The root chart renders its own Application, and the final full-source
    // release operation must prove that apply plus its prunes without waiting
    // on later-wave child health. Keeping the self-reference in the structural
    // wave is what lets that operation reach its applied precondition early;
    // ordering it after the children would couple every release to their
    // health. See `explanation/homelab/release-safety`.
    return APPLICATION_SYNC_WAVES.structural;
  }
  if (name === "1password") {
    return APPLICATION_SYNC_WAVES.onePassword;
  }
  if (PROVIDER_APPLICATIONS.has(name)) {
    return APPLICATION_SYNC_WAVES.provider;
  }
  if (name === "prometheus") {
    return APPLICATION_SYNC_WAVES.prometheus;
  }
  if (name === "alert-dashboard" || name === "trmnl-dashboard") {
    return APPLICATION_SYNC_WAVES.opsSnapshotConsumer;
  }
  if (name === "temporal") {
    return APPLICATION_SYNC_WAVES.temporal;
  }
  if (name === "kueue") {
    return APPLICATION_SYNC_WAVES.kueue;
  }
  if (name === "arcade") {
    return APPLICATION_SYNC_WAVES.arcade;
  }
  return name === "woodpecker"
    ? APPLICATION_SYNC_WAVES.woodpecker
    : APPLICATION_SYNC_WAVES.leaf;
}

/** Under transition rendering AppProjects precede every Application naming them. */
function baselineResourceSyncWave(
  resource: ApiObject,
  transition: boolean,
): string {
  const isAppProject =
    resource.kind === "AppProject" && resource.apiGroup === "argoproj.io";
  return transition && isAppProject
    ? APPLICATION_SYNC_WAVES.appProject
    : rootResourceSyncWave(resource);
}

function rootResourceSyncWave(resource: ApiObject): string {
  if (
    resource.kind === "PriorityClass" &&
    resource.name === BURST_SERVICE_PRIORITY
  ) {
    return APPLICATION_SYNC_WAVES.burstPriorityClass;
  }
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
    if (resource.kind === "ClusterIssuer") {
      return APPLICATION_SYNC_WAVES.clusterIssuer;
    }
    if (resource.kind === "Certificate") {
      return certificateIsCa(resource)
        ? APPLICATION_SYNC_WAVES.certificateAuthority
        : APPLICATION_SYNC_WAVES.certificate;
    }
    return APPLICATION_SYNC_WAVES.certificateIssuer;
  }
  return resource.apiGroup === "kueue.x-k8s.io" ||
    resource.apiGroup === "monitoring.coreos.com" ||
    resource.apiGroup === "networking.cfargotunnel.com" ||
    (resource.apiGroup === "tailscale.com" && resource.kind === "ProxyClass")
    ? APPLICATION_SYNC_WAVES.dependentConfiguration
    : APPLICATION_SYNC_WAVES.structural;
}

const MetadataAnnotationsSchema = z.object({
  annotations: z.record(z.string(), z.string()).optional(),
});

/** Add one `key=value` sync option, keeping any the manifest already declares. */
function mergeSyncOption(construct: ApiObject, option: string): void {
  const declared =
    MetadataAnnotationsSchema.parse(construct.metadata.toJson()).annotations?.[
      ARGOCD_SYNC_OPTIONS_ANNOTATION
    ] ?? "";
  const options = declared
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const key = option.split("=")[0];
  const conflict = options.find(
    (entry) => entry !== option && entry.split("=")[0] === key,
  );
  if (conflict !== undefined) {
    throw new Error(
      `Application ${construct.node.path} declares sync option ${conflict}, which conflicts with ${option}`,
    );
  }
  if (!options.includes(option)) options.push(option);
  construct.metadata.addAnnotation(
    ARGOCD_SYNC_OPTIONS_ANNOTATION,
    options.join(","),
  );
}

function applyLifecyclePolicy(
  construct: ApiObject,
  applicationName: string,
  transitionalRootChild: boolean,
): void {
  if (RETAIN_APPLICATIONS.has(applicationName)) {
    construct.metadata.addAnnotation(
      APPLICATION_LIFECYCLE_ANNOTATION,
      "retain",
    );
  } else if (transitionalRootChild) {
    // Transition rendering hands the root's children to per-service
    // Applications. A retained child without the resources finalizer
    // survives the root being orphaned, and Prune=false keeps a narrowing
    // root manifest from deleting it. `apps` and `argocd` keep their policy.
    construct.metadata.addAnnotation(
      APPLICATION_LIFECYCLE_ANNOTATION,
      "retain",
    );
    mergeSyncOption(construct, "Prune=false");
  } else {
    construct.metadata.addAnnotation(
      APPLICATION_LIFECYCLE_ANNOTATION,
      "cascade",
    );
    construct.metadata.addFinalizers(APPLICATION_RESOURCES_FINALIZER);
  }
}

/**
 * v1's active delegations carry their v1 environment. Under transition
 * rendering every other root child carries its catalog environment, so the
 * first v2 deployment finds its target; a v1 delegation keeps its v1 id until
 * v1 retires, and the window's migration maps the two it renames.
 */
function applyDeliveryOwnership(
  construct: ApiObject,
  applicationName: string,
  stampCatalogEnvironment: boolean,
) {
  const environment =
    DELIVERY_ACTIVE_DELEGATIONS[applicationName] ??
    (stampCatalogEnvironment
      ? catalogApplicationEnvironment(applicationName)
      : undefined);
  if (environment !== undefined) {
    construct.metadata.addAnnotation(
      DELIVERY_ENVIRONMENT_ANNOTATION,
      environment,
    );
    deliveryEnvironment(construct.toJson());
  }
}

function applyResourceReleasePolicy(
  construct: ApiObject,
  revisions: ReturnType<typeof releaseChartRevisions>,
  seenRepositoryCharts: Set<string>,
  transition: boolean,
): void {
  const chartId = Chart.of(construct).node.id;
  const isRootChartResource = chartId === ROOT_CHART;
  const isApplication =
    construct.kind === "Application" && construct.apiGroup === "argoproj.io";
  if (!isApplication) {
    // Baseline and companion charts mirror root objects, waves included.
    if (BASELINE_CHARTS.has(chartId) || COMPANION_CHARTS.has(chartId)) {
      construct.metadata.addAnnotation(
        ARGOCD_SYNC_WAVE_ANNOTATION,
        baselineResourceSyncWave(construct, transition),
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
  applyDeliveryOwnership(
    construct,
    applicationName,
    transition && isRootChartResource,
  );
  if (isRootChartResource) {
    construct.metadata.addAnnotation(
      ARGOCD_SYNC_WAVE_ANNOTATION,
      applicationSyncWave(applicationName),
    );
  }
  if (applicationName !== "apps") {
    construct.metadata.addLabel(MANAGED_APPLICATION_LABEL, "true");
  }
  applyLifecyclePolicy(
    construct,
    applicationName,
    transition && isRootChartResource,
  );

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
  if (deliveryEnvironment(construct.toJson()) !== undefined) return;
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

export function applyApplicationReleasePolicy(
  app: App,
  transition: boolean = transitionRendering(),
): void {
  const revisions = releaseChartRevisions();
  const seenRepositoryCharts = new Set<string>();
  for (const construct of app.node.findAll()) {
    if (ApiObject.isApiObject(construct)) {
      applyResourceReleasePolicy(
        construct,
        revisions,
        seenRepositoryCharts,
        transition,
      );
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
