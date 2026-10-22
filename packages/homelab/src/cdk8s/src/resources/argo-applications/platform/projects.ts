import { ApiObject, type Chart } from "cdk8s";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import { REPOSITORY_CHART_URLS } from "homelab/src/application-release-contract.ts";
import {
  ORDINARY_DELIVERY_ENVIRONMENTS,
  SPECIALIZED_DELIVERY_ENVIRONMENTS,
} from "homelab/src/delivery-target-policy.ts";
import { versionCatalog } from "homelab/src/cdk8s/src/versions.ts";
import { transitionRendering } from "homelab/src/cdk8s/src/release-configuration.ts";
import { BASELINE_CHART_APPLICATIONS } from "homelab/src/cdk8s/src/resources/cluster-baseline/charts.ts";
import { COMPANION_CHARTS } from "homelab/src/cdk8s/src/resources/companions/names.ts";

/**
 * The three ArgoCD AppProjects. `default` is reserved for the root
 * app-of-apps; every child Application lives in `cluster` (may create
 * cluster-scoped resources) or `workloads` (namespaced plus its own Namespace).
 */
export const ARGOCD_PROJECTS = {
  root: "default",
  cluster: "cluster",
  workloads: "workloads",
} as const;
export type ArgoCdProject =
  (typeof ARGOCD_PROJECTS)[keyof typeof ARGOCD_PROJECTS];

export const IN_CLUSTER_SERVER = "https://kubernetes.default.svc";
/** Kustomize source of the one Application that is not a Helm chart. */
export const CLOUDFLARE_OPERATOR_REPOSITORY =
  "https://github.com/adyanth/cloudflare-operator.git";

/**
 * Applications whose chart renders a cluster-scoped kind other than the
 * Namespace every workload owns. Upstream members were classified by rendering
 * each chart with its reviewed values (`helm template --include-crds`);
 * first-party members are checked by `projects.test.ts` against the
 * synthesized charts, which also proves no `workloads` chart renders one.
 */
const CLUSTER_SCOPED_APPLICATIONS: ReadonlySet<string> = new Set([
  // Operators and CRD providers: ClusterRole, CustomResourceDefinition,
  // webhook configurations, APIService, CSIDriver, StorageClass, PriorityClass,
  // IngressClass, GpuDevicePlugin, NodeFeatureRule.
  "1password",
  "alloy",
  "argocd",
  "cert-manager",
  "cloudflare-operator",
  "intel-device-plugin-operator",
  "intel-gpu-device-plugin",
  "kueue",
  "loki",
  "mc-router",
  "nfd",
  "openebs",
  "postgres-operator",
  "prometheus",
  "prometheus-adapter",
  "promtail",
  "seaweedfs",
  "tailscale",
  "velero",
  // First-party charts rendering ClusterRole, ClusterTunnel or admission policies.
  "cloudflare-tunnel",
  "delivery",
  "delivery-control-plane",
  "mc-sandbox",
  "temporal",
  // Baseline and data-layer charts introduced with the Delivery v2 cutover.
  "cluster-admission",
  "cluster-platform",
  "cluster-observability",
  "delivery-data",
  "temporal-data",
]);

const REGISTERED_APPLICATIONS: ReadonlySet<string> = new Set([
  "apps",
  "delivery-control-plane",
  ...Object.keys(ORDINARY_DELIVERY_ENVIRONMENTS),
  ...Object.keys(SPECIALIZED_DELIVERY_ENVIRONMENTS),
  ...SERVICE_CATALOG.services.flatMap((service) => service.argoApps),
  // Created by Delivery from catalog recipes at the window; the root never renders them.
  ...BASELINE_CHART_APPLICATIONS,
  ...COMPANION_CHARTS,
]);

/**
 * The reviewed project of a registered Application; unregistered names fail.
 * Until transition rendering is on, every Application stays in `default`.
 */
/**
 * The Application that renders the AppProjects themselves. It cannot sit in a
 * project it creates, so it uses `default`, which ArgoCD recreates on its own
 * when missing, and a cold recovery can restore every other project from it.
 */
const PROJECT_OWNER_APPLICATION = "argocd-companion";

export function applicationProject(
  name: string,
  transition: boolean = transitionRendering(),
): ArgoCdProject {
  if (name === "apps" || name === PROJECT_OWNER_APPLICATION)
    return ARGOCD_PROJECTS.root;
  if (!REGISTERED_APPLICATIONS.has(name))
    throw new Error(
      `Application ${name} has no reviewed ArgoCD project; register it in the service catalog first`,
    );
  if (!transition) return ARGOCD_PROJECTS.root;
  return CLUSTER_SCOPED_APPLICATIONS.has(name)
    ? ARGOCD_PROJECTS.cluster
    : ARGOCD_PROJECTS.workloads;
}

/**
 * `group/Kind` pairs this cluster treats as cluster-scoped. CDK8s stamps the
 * chart namespace on every object, so scope comes from this table rather than
 * the manifest. An unlisted cluster-scoped kind is rejected by ArgoCD at sync
 * time, which is the intended loud failure.
 */
export const CLUSTER_SCOPED_KINDS: ReadonlySet<string> = new Set([
  "/Namespace",
  "/Node",
  "/PersistentVolume",
  "admissionregistration.k8s.io/MutatingAdmissionPolicy",
  "admissionregistration.k8s.io/MutatingAdmissionPolicyBinding",
  "admissionregistration.k8s.io/MutatingWebhookConfiguration",
  "admissionregistration.k8s.io/ValidatingAdmissionPolicy",
  "admissionregistration.k8s.io/ValidatingAdmissionPolicyBinding",
  "admissionregistration.k8s.io/ValidatingWebhookConfiguration",
  "apiextensions.k8s.io/CustomResourceDefinition",
  "apiregistration.k8s.io/APIService",
  "cert-manager.io/ClusterIssuer",
  "deviceplugin.intel.com/GpuDevicePlugin",
  "flowcontrol.apiserver.k8s.io/FlowSchema",
  "flowcontrol.apiserver.k8s.io/PriorityLevelConfiguration",
  "kueue.x-k8s.io/AdmissionCheck",
  "kueue.x-k8s.io/ClusterQueue",
  "kueue.x-k8s.io/ResourceFlavor",
  "kueue.x-k8s.io/WorkloadPriorityClass",
  "networking.cfargotunnel.com/ClusterTunnel",
  "networking.k8s.io/IngressClass",
  "nfd.k8s-sigs.io/NodeFeatureGroup",
  "nfd.k8s-sigs.io/NodeFeatureRule",
  "node.k8s.io/RuntimeClass",
  "rbac.authorization.k8s.io/ClusterRole",
  "rbac.authorization.k8s.io/ClusterRoleBinding",
  "scheduling.k8s.io/PriorityClass",
  "snapshot.storage.k8s.io/VolumeSnapshotClass",
  "storage.k8s.io/CSIDriver",
  "storage.k8s.io/StorageClass",
  "storage.k8s.io/VolumeAttachment",
  "tailscale.com/ProxyClass",
]);

export type ClusterResource = { group: string; kind: string };

/** CDK8s names the core group `core`; ArgoCD and the API spell it empty. */
export function apiGroupName(apiGroup: string): string {
  return apiGroup === "core" ? "" : apiGroup;
}

export function isClusterScoped(group: string, kind: string): boolean {
  return CLUSTER_SCOPED_KINDS.has(`${apiGroupName(group)}/${kind}`);
}

/** The distinct cluster-scoped `group/kind` pairs a chart renders, sorted. */
export function renderedClusterResources(chart: Chart): ClusterResource[] {
  const seen = new Map<string, ClusterResource>();
  for (const construct of chart.node.findAll()) {
    if (!ApiObject.isApiObject(construct)) continue;
    const group = apiGroupName(construct.apiGroup);
    if (!isClusterScoped(group, construct.kind)) continue;
    seen.set(`${group}/${construct.kind}`, { group, kind: construct.kind });
  }
  return [...seen.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, resource]) => resource);
}

/**
 * Every upstream chart repository the version catalog pins, spelled as the
 * Applications address it. ArgoCD compares `sourceRepos` literally (lowercase,
 * `.git` stripped, no other normalization), so an OCI registry becomes the
 * scheme-less `host/path` form Helm uses, and an HTTP repository is listed
 * both as the catalog spells it and with the trailing slash some Applications
 * have always used; both name the same repository.
 */
export function upstreamChartRepositories(): string[] {
  const repositories = new Set<string>();
  for (const entry of versionCatalog.entries) {
    if (entry.artifactType !== "helm-chart") continue;
    if (!entry.management.managed)
      throw new Error(
        `Helm chart ${entry.name} is not a managed catalog entry`,
      );
    const { datasource, registryUrl, packageName } = entry.management;
    if (registryUrl === undefined)
      throw new Error(`Helm chart ${entry.name} has no registry URL`);
    switch (datasource) {
      case "helm":
        repositories.add(registryUrl.replace(/\/$/u, ""));
        repositories.add(`${registryUrl.replace(/\/$/u, "")}/`);
        break;
      case "docker": {
        if (packageName === undefined)
          throw new Error(`OCI chart ${entry.name} has no package name`);
        const path = packageName.split("/").slice(0, -1).join("/");
        repositories.add(`${new URL(registryUrl).host}/${path}`);
        break;
      }
      default:
        throw new Error(
          `Helm chart ${entry.name} uses unsupported datasource ${datasource}`,
        );
    }
  }
  return [...repositories].sort();
}

/** Sources any child project may draw from: repository charts, pinned upstream charts, the operator Kustomize tree. */
export function childSourceRepositories(): string[] {
  return [
    ...new Set([
      ...REPOSITORY_CHART_URLS,
      ...upstreamChartRepositories(),
      CLOUDFLARE_OPERATOR_REPOSITORY,
    ]),
  ].sort();
}

/** Only repository charts; the root never renders upstream sources directly. */
export function rootSourceRepositories(): string[] {
  return [...REPOSITORY_CHART_URLS].sort();
}
