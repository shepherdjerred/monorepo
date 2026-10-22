import { describe, expect, it, test, vi } from "vitest";
import type * as ReleaseConfiguration from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import { App } from "cdk8s";
import { z } from "zod";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import {
  APPLICATION_SYNC_WAVES,
  ARGOCD_SYNC_WAVE_ANNOTATION,
  REPOSITORY_CHART_URLS,
} from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { deliveryKnownApplications } from "./delivery-rbac.ts";
import {
  ARGOCD_PROJECTS,
  CLOUDFLARE_OPERATOR_REPOSITORY,
  IN_CLUSTER_SERVER,
  apiGroupName,
  applicationProject,
  childSourceRepositories,
  isClusterScoped,
  upstreamChartRepositories,
} from "./projects.ts";

// The AppProject split exists only under transition rendering, which the
// committed switch keeps off until the cutover window.
vi.mock(
  "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts",
  async (importOriginal) => ({
    ...(await importOriginal<typeof ReleaseConfiguration>()),
    transitionRendering: () => true,
  }),
);

const ManifestSchema = z.looseObject({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});
const ApplicationSchema = ManifestSchema.extend({
  apiVersion: z.string().startsWith("argoproj.io/"),
  kind: z.literal("Application"),
  spec: z.looseObject({
    project: z.string(),
    source: z.looseObject({
      repoURL: z.string(),
      chart: z.string().optional(),
      path: z.string().optional(),
    }),
    destination: z.looseObject({ server: z.string(), namespace: z.string() }),
  }),
});
const AppProjectSchema = ManifestSchema.extend({
  apiVersion: z.string().startsWith("argoproj.io/"),
  kind: z.literal("AppProject"),
  spec: z.looseObject({
    sourceRepos: z.array(z.string()),
    destinations: z.array(
      z.object({ server: z.string(), namespace: z.string() }),
    ),
    clusterResourceWhitelist: z.array(
      z.object({ group: z.string(), kind: z.string() }),
    ),
  }),
});
type Manifest = z.infer<typeof ManifestSchema>;

const app = new App({ outdir: ".test-synth-argocd-projects" });
await setupCharts(app);
const charts = new Map(
  app.charts.map((chart) => [
    chart.node.id,
    z.array(ManifestSchema).parse(chart.toJson()),
  ]),
);
const rootManifests = z.array(ManifestSchema).parse(charts.get("apps"));
const applications = [...charts.values()]
  .flat()
  .map((manifest) => ApplicationSchema.safeParse(manifest))
  .filter((result) => result.success)
  .map((result) => result.data);
const projects = new Map(
  rootManifests
    .map((manifest) => AppProjectSchema.safeParse(manifest))
    .filter((result) => result.success)
    .map((result) => [result.data.metadata.name, result.data.spec]),
);

/** ArgoCD compares source repositories lowercased with `.git` stripped and no other normalization. */
function argoRepository(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/\.git$/u, "");
}
function clusterScopedKinds(manifests: Manifest[]): string[] {
  const kinds = new Set<string>();
  for (const manifest of manifests) {
    const separator = manifest.apiVersion.indexOf("/");
    const group = apiGroupName(
      separator === -1 ? "core" : manifest.apiVersion.slice(0, separator),
    );
    if (isClusterScoped(group, manifest.kind))
      kinds.add(`${group}/${manifest.kind}`);
  }
  return [...kinds].sort();
}
const upstreamMirrorCharts = new Set(
  SERVICE_CATALOG.services.flatMap((service) =>
    service.charts.filter(
      (chart) => service.rootReleaseExclusions?.[chart] === "upstream",
    ),
  ),
);

describe("ArgoCD project assignment", () => {
  it("assigns every registered Application and refuses unknown names", () => {
    for (const name of deliveryKnownApplications(true))
      expect(() => applicationProject(name, true)).not.toThrow();
    expect(applicationProject("apps")).toBe(ARGOCD_PROJECTS.root);
    expect(applicationProject("argocd")).toBe(ARGOCD_PROJECTS.cluster);
    expect(applicationProject("delivery")).toBe(ARGOCD_PROJECTS.cluster);
    expect(applicationProject("arcade")).toBe(ARGOCD_PROJECTS.workloads);
    expect(() => applicationProject("unregistered")).toThrow(
      "no reviewed ArgoCD project",
    );
  });

  it("renders every Application in its reviewed project with a permitted source", () => {
    expect(applications.length).toBeGreaterThan(50);
    expect([...projects.keys()].sort()).toEqual(
      Object.values(ARGOCD_PROJECTS).sort(),
    );
    const mismatched = applications
      .filter(
        ({ metadata, spec }) =>
          spec.project !== applicationProject(metadata.name),
      )
      .map(({ metadata, spec }) => `${metadata.name}: ${spec.project}`);
    expect(mismatched).toEqual([]);
    for (const { metadata, spec } of applications) {
      const project = projects.get(spec.project);
      expect(project, metadata.name).toBeDefined();
      expect(spec.destination.server).toBe(IN_CLUSTER_SERVER);
      expect(
        project?.sourceRepos.some(
          (repository) =>
            argoRepository(repository) === argoRepository(spec.source.repoURL),
        ),
        `${metadata.name} source ${spec.source.repoURL} in ${spec.project}`,
      ).toBe(true);
    }
  });

  it("keeps cluster-scoped first-party charts out of the workloads project", () => {
    const offenders: string[] = [];
    for (const { metadata, spec } of applications) {
      if (
        !REPOSITORY_CHART_URLS.has(spec.source.repoURL) ||
        spec.source.chart === undefined
      )
        continue;
      const chart = charts.get(spec.source.chart);
      if (chart === undefined) {
        expect(
          upstreamMirrorCharts.has(spec.source.chart),
          `${metadata.name} uses unsynthesized chart ${spec.source.chart}`,
        ).toBe(true);
        continue;
      }
      const kinds = clusterScopedKinds(chart).filter(
        (kind) => kind !== "/Namespace",
      );
      if (spec.project === ARGOCD_PROJECTS.workloads && kinds.length > 0)
        offenders.push(`${metadata.name}: ${kinds.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("ArgoCD AppProjects", () => {
  it("keeps default to the repository charts and the kinds the root renders", () => {
    const root = projects.get(ARGOCD_PROJECTS.root);
    expect(root?.sourceRepos).toEqual([...REPOSITORY_CHART_URLS].sort());
    expect(root?.destinations).toEqual([
      { server: IN_CLUSTER_SERVER, namespace: "*" },
    ]);
    const whitelisted = root?.clusterResourceWhitelist.map(
      ({ group, kind }) => `${group}/${kind}`,
    );
    expect(whitelisted).toEqual(clusterScopedKinds(rootManifests));
    expect(whitelisted).toContain("/Namespace");
    expect(whitelisted).toContain(
      "admissionregistration.k8s.io/ValidatingAdmissionPolicy",
    );
    expect(whitelisted?.some((entry) => entry.includes("*"))).toBe(false);
  });

  it("gives cluster every cluster-scoped kind and workloads only a Namespace", () => {
    const cluster = projects.get(ARGOCD_PROJECTS.cluster);
    const workloads = projects.get(ARGOCD_PROJECTS.workloads);
    expect(cluster?.clusterResourceWhitelist).toEqual([
      { group: "*", kind: "*" },
    ]);
    expect(workloads?.clusterResourceWhitelist).toEqual([
      { group: "", kind: "Namespace" },
    ]);
    for (const project of [cluster, workloads]) {
      expect(project?.destinations).toEqual([
        { server: IN_CLUSTER_SERVER, namespace: "*" },
      ]);
      expect(project?.sourceRepos).toEqual(childSourceRepositories());
      expect(project?.sourceRepos.some((repo) => repo.includes("*"))).toBe(
        false,
      );
    }
  });

  it("lets every project reach the namespaces Delivery's readers and their workloads use", () => {
    const required = [
      "argocd",
      "storm-forum",
      "storm-forum-beta",
      "temporal",
      "scout-beta",
      "scout-prod",
    ];
    for (const name of Object.values(ARGOCD_PROJECTS)) {
      const project = projects.get(name);
      for (const namespace of required)
        expect(
          project?.destinations.some(
            (destination) =>
              destination.server === IN_CLUSTER_SERVER &&
              (destination.namespace === "*" ||
                destination.namespace === namespace),
          ),
        ).toBe(true);
      // Roles, RoleBindings and workloads are namespaced kinds; no project
      // may filter them.
      expect(project).not.toHaveProperty("namespaceResourceWhitelist");
      expect(project).not.toHaveProperty("namespaceResourceBlacklist");
    }
  });

  it("derives child sources from the version catalog", () => {
    const upstream = upstreamChartRepositories();
    expect(upstream).toContain("https://argoproj.github.io/argo-helm");
    expect(upstream).toContain("https://charts.bitnami.com/bitnami");
    expect(upstream).toContain("registry.k8s.io/kueue/charts");
    expect(new Set(upstream).size).toBe(upstream.length);
    const sources = childSourceRepositories();
    for (const repository of [
      ...REPOSITORY_CHART_URLS,
      ...upstream,
      CLOUDFLARE_OPERATOR_REPOSITORY,
    ])
      expect(sources).toContain(repository);
  });

  it("syncs AppProjects before every other root resource", () => {
    const waves = rootManifests.map((manifest) => ({
      name: `${manifest.kind}/${manifest.metadata.name}`,
      project: manifest.kind === "AppProject",
      wave: Number(
        manifest.metadata.annotations?.[ARGOCD_SYNC_WAVE_ANNOTATION],
      ),
    }));
    const projectWaves = waves.filter((entry) => entry.project);
    expect(projectWaves).toHaveLength(3);
    for (const entry of projectWaves)
      expect(entry.wave).toBe(Number(APPLICATION_SYNC_WAVES.appProject));
    const earliestOther = Math.min(
      ...waves.filter((entry) => !entry.project).map((entry) => entry.wave),
    );
    expect(Number(APPLICATION_SYNC_WAVES.appProject)).toBeLessThan(
      earliestOther,
    );
  });
});

test("the Application that renders the AppProjects lives in default, which ArgoCD recreates on its own", () => {
  expect(applicationProject("argocd-companion", true)).toBe(
    ARGOCD_PROJECTS.root,
  );
  expect(applicationProject("velero-companion", true)).not.toBe(
    ARGOCD_PROJECTS.root,
  );
});
