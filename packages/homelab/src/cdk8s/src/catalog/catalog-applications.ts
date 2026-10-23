import { App, Chart } from "cdk8s";
import { z } from "zod";
import {
  type ApplicationBody,
  ApplicationBodySchema,
  type RecipeDefinition,
} from "@shepherdjerred/delivery/model-contract";
import { applyApplicationReleasePolicy } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { createAdoptingApplication } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/adopting-applications.ts";
import {
  BASELINE_CHART_APPLICATIONS,
  BASELINE_CHART_NAMESPACE,
  ROOT_CHART,
} from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";
import {
  COMPANION_APPLICATIONS,
  companionChartName,
  FOLLOWING_COMPANIONS,
} from "@shepherdjerred/homelab/cdk8s/src/resources/companions/names.ts";

/**
 * The Applications a catalog recipe describes, as the root chart's Helm
 * render hands them to ArgoCD with transition rendering on, plus the
 * Applications Delivery creates that the root never renders.
 */

const APPLICATION_LIFECYCLE_ANNOTATION = "ci.sjer.red/application-lifecycle";
/**
 * Root-release annotations with no meaning once Delivery owns the
 * Application: waves order only the root's sync, and edges replace them
 * (Z3); the v1 delegation names v1 environment ids the window retires.
 */
const ROOT_ONLY_ANNOTATIONS: ReadonlySet<string> = new Set([
  "argocd.argoproj.io/sync-wave",
  "delivery.shepherdjerred.com/environment",
]);
const StringMap = z.record(z.string(), z.string());
const ApplicationManifestSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({
    name: z.string(),
    namespace: z.literal("argocd"),
    labels: StringMap.optional(),
    annotations: StringMap.optional(),
    finalizers: z.array(z.string()).optional(),
  }),
  spec: z.object({
    project: z.string(),
    destination: z.object({ server: z.string(), namespace: z.string() }),
    // A Helm chart from an HTTPS or OCI repository, or a Git path
    // (cloudflare-operator's Kustomize directory).
    source: z.union([
      z.object({
        repoURL: z.string(),
        chart: z.string(),
        targetRevision: z.string(),
        helm: z
          .object({
            releaseName: z.string().optional(),
            valuesObject: z.record(z.string(), z.unknown()).optional(),
          })
          .strict()
          .optional(),
      }),
      z.strictObject({
        repoURL: z.string(),
        path: z.string(),
        targetRevision: z.string(),
      }),
    ]),
    syncPolicy: z
      .object({
        automated: z.unknown().optional(),
        syncOptions: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    ignoreDifferences: z.array(z.record(z.string(), z.unknown())).optional(),
    revisionHistoryLimit: z.number().int().optional(),
  }),
});
export type ApplicationManifest = z.infer<typeof ApplicationManifestSchema>;
const ManifestKindSchema = z.looseObject({ kind: z.string() });

const ESCAPED_OPEN = '{{ "{{" }}';
const ESCAPED_CLOSE = '{{ "}}" }}';

/**
 * The text the root chart's Helm render hands ArgoCD: constructors escape a
 * template meant for an upstream chart (`escapeHelmGoTemplate`), and the root
 * render removes that escape. Any other root template has no value outside
 * the root, so it must be bound or it fails.
 */
export function rootRendered(text: string, where: string): string {
  if (
    text
      .replaceAll(ESCAPED_OPEN, "")
      .replaceAll(ESCAPED_CLOSE, "")
      .includes("{{")
  )
    throw new Error(`${where} carries a root chart template`);
  return text.replaceAll(ESCAPED_OPEN, "{{").replaceAll(ESCAPED_CLOSE, "}}");
}

/** Apply `map` to every string inside a JSON value. */
export function mapStrings(
  value: unknown,
  map: (text: string) => string,
): unknown {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value))
    return value.map((entry: unknown) => mapStrings(entry, map));
  return typeof value === "object" && value !== null
    ? Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          mapStrings(entry, map),
        ]),
      )
    : value;
}

function applicationsOf(app: App): Map<string, ApplicationManifest> {
  const applications = new Map<string, ApplicationManifest>();
  for (const chart of app.charts)
    for (const manifest of z.array(z.unknown()).parse(chart.toJson())) {
      if (ManifestKindSchema.parse(manifest).kind !== "Application") continue;
      const application = ApplicationManifestSchema.safeParse(manifest);
      // The root Application is no catalog Application.
      if (!application.success) continue;
      applications.set(application.data.metadata.name, application.data);
    }
  return applications;
}

const DestinationSchema = z.looseObject({
  kind: z.literal("Application"),
  metadata: z.looseObject({ name: z.string() }),
  spec: z.looseObject({
    destination: z.looseObject({ namespace: z.string() }),
  }),
});

/** Destination namespace of every rendered Application, chart-sourced or not. */
function applicationDestinations(app: App): Map<string, string> {
  return new Map(
    app.charts
      .flatMap((chart) => z.array(z.unknown()).parse(chart.toJson()))
      .map((manifest) => DestinationSchema.safeParse(manifest))
      .filter((result) => result.success)
      .map((result) => [
        result.data.metadata.name,
        result.data.spec.destination.namespace,
      ]),
  );
}

/** The Applications Delivery creates that the root never renders, stamped as root children are. */
function adoptingApplications(
  destinations: ReadonlyMap<string, string>,
): Map<string, ApplicationManifest> {
  const scratch = new App();
  const chart = new Chart(scratch, ROOT_CHART, {
    namespace: BASELINE_CHART_NAMESPACE,
    disableResourceNameHashes: true,
  });
  for (const name of BASELINE_CHART_APPLICATIONS)
    createAdoptingApplication(chart, name, BASELINE_CHART_NAMESPACE);
  const namespaceOf = (application: string) => {
    const namespace = destinations.get(application);
    if (namespace === undefined)
      throw new Error(
        `Companion of ${application} has no rendered Application`,
      );
    return namespace;
  };
  for (const application of COMPANION_APPLICATIONS)
    createAdoptingApplication(
      chart,
      companionChartName(application),
      namespaceOf(application),
    );
  for (const [application, following] of Object.entries(FOLLOWING_COMPANIONS))
    createAdoptingApplication(chart, following, namespaceOf(application));
  applyApplicationReleasePolicy(scratch, true);
  return applicationsOf(scratch);
}

/** Every chart Application a catalog recipe may describe, by name. */
export function catalogApplications(
  app: App,
): ReadonlyMap<string, ApplicationManifest> {
  return new Map([
    ...applicationsOf(app),
    ...adoptingApplications(applicationDestinations(app)),
  ]);
}

export function applicationBody(
  rendered: ApplicationManifest,
): ApplicationBody {
  // The chart source keeps its root template (`targetRevision`) and values;
  // the deployment binds the first and the configuration carries the second.
  const { source, ...outer } = rendered.spec;
  const checked = z
    .object({ metadata: z.unknown(), spec: z.record(z.string(), z.unknown()) })
    .parse(
      mapStrings({ metadata: rendered.metadata, spec: outer }, (text) =>
        rootRendered(text, `Application ${rendered.metadata.name}`),
      ),
    );
  const manifest = ApplicationManifestSchema.parse({
    kind: "Application",
    metadata: checked.metadata,
    spec: { ...checked.spec, source },
  });
  const annotations = Object.fromEntries(
    Object.entries(manifest.metadata.annotations ?? {}).filter(
      ([key]) => !ROOT_ONLY_ANNOTATIONS.has(key),
    ),
  );
  const lifecycle = z
    .enum(["retain", "cascade"])
    .parse(manifest.metadata.annotations?.[APPLICATION_LIFECYCLE_ANNOTATION]);
  const bodySource = manifest.spec.source;
  const releaseName =
    "chart" in bodySource ? bodySource.helm?.releaseName : undefined;
  return ApplicationBodySchema.parse({
    name: manifest.metadata.name,
    metadata: {
      labels: manifest.metadata.labels ?? {},
      annotations,
      finalizers: manifest.metadata.finalizers ?? [],
    },
    project: manifest.spec.project,
    destination: manifest.spec.destination,
    // The revision is never a literal (C2): the chart or archive component
    // binds it.
    source:
      "chart" in bodySource
        ? {
            repoURL: bodySource.repoURL,
            chart: bodySource.chart,
            ...(releaseName === undefined ? {} : { helm: { releaseName } }),
          }
        : { repoURL: bodySource.repoURL, path: bodySource.path },
    syncOptions: manifest.spec.syncPolicy?.syncOptions ?? [],
    // The schema rejects any ignore field it does not model.
    ignoreDifferences: manifest.spec.ignoreDifferences ?? [],
    ...(manifest.spec.revisionHistoryLimit === undefined
      ? {}
      : { revisionHistoryLimit: manifest.spec.revisionHistoryLimit }),
    lifecycle,
  });
}

export function walkStrings(
  value: unknown,
  path: (string | number)[],
  visit: (text: string, path: (string | number)[]) => void,
): void {
  if (typeof value === "string") visit(value, path);
  else if (Array.isArray(value))
    for (const [index, entry] of value.entries())
      walkStrings(entry, [...path, index], visit);
  else if (typeof value === "object" && value !== null)
    for (const [key, entry] of Object.entries(value))
      walkStrings(entry, [...path, key], visit);
}

/** Helm `--set` spelling of a values path: `initContainers[0].image`. */
export function helmPath(path: readonly (string | number)[]): string {
  return path
    .map((segment, index) =>
      typeof segment === "number"
        ? `[${String(segment)}]`
        : `${index === 0 ? "" : "."}${segment}`,
    )
    .join("");
}

/** The Applications a recipe creates or updates, in step order. */
export function recipeApplications(definition: RecipeDefinition): string[] {
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

/**
 * The component whose artifact fixes an Application's source revision: its
 * chart, or for a Git path an archive of the exact commit, named after the
 * Application.
 */
export function sourceComponent(manifest: ApplicationManifest): string {
  const { source } = manifest.spec;
  return "chart" in source
    ? `chart:${source.chart}`
    : `archive:${manifest.metadata.name}`;
}
