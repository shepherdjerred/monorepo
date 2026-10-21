import type { App } from "cdk8s";
import { z } from "zod";
import type { RecipeDefinition } from "@shepherdjerred/delivery/model-contract";
import type { CatalogCore } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import {
  environmentService,
  type PrerequisiteEdge,
} from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { TOFU_STACK_POLICIES } from "@shepherdjerred/ops-model/platform-policy.ts";
import { CLUSTER_PLATFORM_CHART } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";
import type { CatalogRevisions } from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-revisions.ts";

/**
 * Prerequisite edges (Delivery model, 4.18) derived from the ordering
 * contracts that are real today (Z3): a custom resource needs its CRD
 * provider, a OnePasswordItem needs 1Password Connect, a pod naming a
 * PriorityClass or a claim naming a StorageClass needs the platform baseline
 * (and OpenEBS for a ZFS claim), a bucket user needs the SeaweedFS stack, and
 * the OpenTofu stack order `platform-policy.json` reviews. An Ingress that
 * names a class is not an edge: the API server admits it before its
 * controller exists. Namespace creation is not one either; every Application
 * may create its own.
 *
 * Every edge is `any-accepted`: none of these contracts needs a matching
 * build, only a provider that has ever been accepted.
 */

const ADMISSION = "cluster-admission/prod";
const PLATFORM = `${CLUSTER_PLATFORM_CHART}/prod`;
/** Custom resource API groups and the environment whose chart serves the CRD. */
const CRD_PROVIDERS: Readonly<Record<string, string>> = {
  "onepassword.com": "1password/prod",
  "cert-manager.io": "cert-manager/prod",
  "acid.zalan.do": "postgres-operator/prod",
  "tailscale.com": "tailscale/prod",
  "velero.io": "velero/prod",
  "monitoring.coreos.com": "prometheus/prod",
  "argoproj.io": "argocd/prod",
};
/**
 * CRD providers the catalog cannot give an environment yet: the recipe
 * contract has no Kustomize-path source (cloudflare-operator) and no
 * scheme-less OCI repository (kueue). Their consumers' edges wait for that.
 */
export const UNREPRESENTED_PROVIDERS: Readonly<Record<string, string>> = {
  "networking.cfargotunnel.com": "cloudflare-operator/prod",
  "kueue.x-k8s.io": "kueue/prod",
};
const SEAWEEDFS_STACK = "tofu-seaweedfs/prod";
const SEAWEEDFS_S3 = "seaweedfs-s3.seaweedfs.svc.cluster.local";
const GPU_RESOURCE = "gpu.intel.com/i915";

/** Ordering contracts no object reveals; each names its reason. */
const DECLARED_EDGES: readonly [dependent: string, prerequisite: string][] = [
  // The self-hosted applications run on their operator-run data layers.
  ["delivery/prod", "delivery-data/prod"],
  ["temporal/prod", "temporal-data/prod"],
  // The cluster CA issues the certificate Alertmanager requires for Postal SMTP.
  ["prometheus/prod", PLATFORM],
  // CI and Delivery's stage Jobs run under the Kueue queues the baseline declares.
  ["woodpecker/prod", PLATFORM],
  ["delivery-control-plane/prod", PLATFORM],
  ["minecraft/sandbox", PLATFORM],
  // The GPU plugin's CR needs the operator's CRD and the node feature labels.
  ["intel-gpu-device-plugin/prod", "intel-device-plugin-operator/prod"],
  ["intel-gpu-device-plugin/prod", "nfd/prod"],
  // The tailnet ACL declares the tags the operator's devices take.
  ["tailscale/prod", "tofu-tailscale/prod"],
  // The arr stack configures Radarr, Sonarr and Prowlarr in the media Application.
  ["tofu-arr/prod", "streambot/prod"],
  // DNS points at the proxy's routes only once the proxy serves them.
  ["tofu-cloudflare/prod", "static-site-proxy/prod"],
];

const ManifestSchema = z.looseObject({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
});
const ValuesSchema = z.looseObject({
  spec: z.looseObject({
    source: z.looseObject({
      chart: z.string().optional(),
      helm: z.looseObject({ valuesObject: z.unknown() }).optional(),
    }),
  }),
});

function apiGroup(apiVersion: string): string {
  const separator = apiVersion.indexOf("/");
  return separator === -1 ? "" : apiVersion.slice(0, separator);
}

function recipeApplications(definition: RecipeDefinition): string[] {
  switch (definition.kind) {
    case "kubernetes-application":
      return [definition.application.name];
    case "operator-run":
      return definition.wrapped.kind === "kubernetes-application"
        ? [definition.wrapped.application.name]
        : [];
    case "compound":
      return definition.subRecipes.flatMap((sub) =>
        recipeApplications(sub.definition),
      );
    case "static-site":
    case "tofu":
    case "channel":
      return [];
  }
}

type EnvironmentContent = {
  objects: z.infer<typeof ManifestSchema>[];
  text: string;
  /** Every object key, including keys whose value synthesis leaves undefined. */
  keys: Set<string>;
};

function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value))
    for (const entry of z.array(z.unknown()).parse(value))
      collectKeys(entry, keys);
  else if (typeof value === "object" && value !== null)
    for (const [key, entry] of Object.entries(value)) {
      keys.add(key);
      collectKeys(entry, keys);
    }
}

/** What an environment's Applications deploy that the repository can see. */
function environmentContent(
  app: App,
  applications: ReadonlyMap<string, unknown>,
  names: readonly string[],
): EnvironmentContent {
  const objects: z.infer<typeof ManifestSchema>[] = [];
  const texts: string[] = [];
  const keys = new Set<string>();
  for (const name of names) {
    const source = ValuesSchema.parse(applications.get(name)).spec.source;
    texts.push(JSON.stringify(source.helm?.valuesObject ?? {}));
    const chart = app.charts.find(
      (candidate) => candidate.node.id === source.chart,
    );
    if (chart === undefined) continue;
    const raw = chart.toJson();
    collectKeys(raw, keys);
    const manifests = z.array(ManifestSchema).parse(raw);
    objects.push(...manifests);
    texts.push(JSON.stringify(manifests));
  }
  return { objects, text: texts.join("\n"), keys };
}

function platformClassNames(app: App): {
  storage: string[];
  zfsStorage: string[];
  priority: string[];
} {
  const chart = app.charts.find(
    (candidate) => candidate.node.id === CLUSTER_PLATFORM_CHART,
  );
  if (chart === undefined) throw new Error("cluster-platform is not rendered");
  const manifests = z
    .array(ManifestSchema.extend({ provisioner: z.string().optional() }))
    .parse(chart.toJson());
  const storage = manifests.filter(
    (manifest) => manifest.kind === "StorageClass",
  );
  return {
    storage: storage.map((manifest) => manifest.metadata.name),
    zfsStorage: storage
      .filter((manifest) => manifest.provisioner === "zfs.csi.openebs.io")
      .map((manifest) => manifest.metadata.name),
    priority: manifests
      .filter((manifest) => manifest.kind === "PriorityClass")
      .map((manifest) => manifest.metadata.name),
  };
}

function mentions(text: string, names: readonly string[]): boolean {
  return names.some((name) => text.includes(JSON.stringify(name)));
}

export type EdgeInputs = {
  core: CatalogCore;
  app: App;
  applications: ReadonlyMap<string, unknown>;
  revisions: ReadonlyMap<string, CatalogRevisions>;
};

/** Edges keyed by pair; every side must be a catalog environment. */
class EdgeSet {
  readonly #edges = new Map<string, PrerequisiteEdge>();
  constructor(readonly environments: ReadonlySet<string>) {}

  add(dependent: string, prerequisite: string): void {
    if (dependent === prerequisite) return;
    for (const side of [dependent, prerequisite])
      if (!this.environments.has(side))
        throw new Error(`Edge ${prerequisite} -> ${dependent} names ${side}`);
    this.#edges.set(`${dependent}\n${prerequisite}`, {
      dependent,
      prerequisite,
      rule: "any-accepted",
    });
  }

  sorted(): PrerequisiteEdge[] {
    return [...this.#edges.values()].sort(
      (left, right) =>
        left.dependent.localeCompare(right.dependent) ||
        left.prerequisite.localeCompare(right.prerequisite),
    );
  }
}

/** Prerequisites an environment's own objects and values reveal. */
function contentPrerequisites(
  environmentId: string,
  content: EnvironmentContent,
  classes: ReturnType<typeof platformClassNames>,
): string[] {
  const prerequisites = [ADMISSION];
  for (const manifest of content.objects) {
    const provider = CRD_PROVIDERS[apiGroup(manifest.apiVersion)];
    if (provider !== undefined) prerequisites.push(provider);
  }
  // The baseline declares the classes; naming them is not using them.
  if (environmentId !== PLATFORM) {
    if (
      mentions(content.text, classes.storage) ||
      mentions(content.text, classes.priority)
    )
      prerequisites.push(PLATFORM);
    if (mentions(content.text, classes.zfsStorage))
      prerequisites.push("openebs/prod");
  }
  // A GPU limit is an undefined placeholder until `scripts/patch.ts` sets it.
  if (content.keys.has(GPU_RESOURCE))
    prerequisites.push("intel-gpu-device-plugin/prod");
  const service = environmentService(environmentId);
  // SeaweedFS serves the endpoint and the probes only check it is up.
  if (
    service !== "seaweedfs" &&
    service !== "service-probes" &&
    content.text.includes(SEAWEEDFS_S3)
  )
    prerequisites.push(SEAWEEDFS_STACK);
  return prerequisites;
}

function usesTunnel(content: EnvironmentContent): boolean {
  return content.objects.some(
    (manifest) =>
      apiGroup(manifest.apiVersion) === "networking.cfargotunnel.com",
  );
}

function addPolicyEdges(edges: EdgeSet): void {
  for (const [stack, { prerequisites }] of Object.entries(
    TOFU_STACK_POLICIES,
  )) {
    const dependent = `tofu-${stack}/prod`;
    if (!edges.environments.has(dependent)) continue;
    for (const prerequisite of prerequisites.filter((entry) =>
      entry.startsWith("tofu:"),
    ))
      edges.add(dependent, `tofu-${prerequisite.slice("tofu:".length)}/prod`);
  }
}

/** A tracking reference recomposes on its source's acceptance (A5, G3). */
function addTrackingEdges(edges: EdgeSet, core: CatalogCore): void {
  for (const service of core.services)
    for (const source of service.components.flatMap((component) =>
      component.source?.mode === "tracking" ? [component.source] : [],
    ))
      for (const environment of core.environments.filter(
        (candidate) => environmentService(candidate.id) === service.id,
      ))
        edges.add(environment.id, z.string().parse(source.environment));
}

/** The edges the catalog must declare, sorted by dependent then prerequisite. */
export function derivedEdges(inputs: EdgeInputs): PrerequisiteEdge[] {
  const edges = new EdgeSet(
    new Set(inputs.core.environments.map((environment) => environment.id)),
  );
  const classes = platformClassNames(inputs.app);
  // DNS for a tunnel route or a site follows the route and the site content.
  const dnsPrerequisites: string[] = [];
  for (const [environmentId, revision] of inputs.revisions) {
    if (revision.recipe.definition.kind === "static-site") {
      edges.add(environmentId, SEAWEEDFS_STACK);
      dnsPrerequisites.push(environmentId);
      continue;
    }
    const names = recipeApplications(revision.recipe.definition);
    if (names.length === 0) continue;
    const content = environmentContent(inputs.app, inputs.applications, names);
    for (const prerequisite of contentPrerequisites(
      environmentId,
      content,
      classes,
    ))
      edges.add(environmentId, prerequisite);
    if (usesTunnel(content)) dnsPrerequisites.push(environmentId);
  }
  // Scout's frontends activate into SeaweedFS buckets like the sites do.
  for (const environmentId of ["scout-for-lol/beta", "scout-for-lol/prod"])
    edges.add(environmentId, SEAWEEDFS_STACK);
  for (const environmentId of dnsPrerequisites)
    edges.add("tofu-cloudflare/prod", environmentId);
  addPolicyEdges(edges);
  for (const [dependent, prerequisite] of DECLARED_EDGES)
    edges.add(dependent, prerequisite);
  addTrackingEdges(edges, inputs.core);
  return edges.sorted();
}
