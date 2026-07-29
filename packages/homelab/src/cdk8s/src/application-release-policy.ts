import { ApiObject, JsonPatch, type App } from "cdk8s";
import { z } from "zod";
import { releaseChartRevisions } from "./release-configuration.ts";

export const APPLICATION_RESOURCES_FINALIZER =
  "resources-finalizer.argocd.argoproj.io";
export const APPLICATION_LIFECYCLE_ANNOTATION =
  "ci.sjer.red/application-lifecycle";

const RETAIN_APPLICATIONS = new Set(["apps", "argocd"]);
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

export function applyApplicationReleasePolicy(app: App): void {
  const revisions = releaseChartRevisions();
  const seenRepositoryCharts = new Set<string>();
  for (const construct of app.node.findAll()) {
    if (
      !ApiObject.isApiObject(construct) ||
      construct.kind !== "Application" ||
      construct.apiGroup !== "argoproj.io"
    ) {
      continue;
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
      continue;
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
