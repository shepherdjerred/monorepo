import type { StaticSitePolicy } from "#shared/static-site-contract.ts";
import type { WorkerPoolTarget } from "#shared/worker-contract.ts";
import type { StoredRecipeDefinition } from "./record-contract.ts";
import type { Monitor } from "./monitor-contract.ts";
import {
  type ApplicationBody,
  type ArtifactParameter,
  helmSource,
  type KubernetesStep,
  type RecipeDefinition,
  referenceParameters,
} from "./recipe-contract.ts";

/**
 * Generation-agnostic views of a stored recipe. Pre-cutover rows hold v1
 * pipeline definitions with fixed blocks (`workerRollout`, `scoutSite`, …);
 * model recipes express the same intent as ordered steps (T3). Every
 * consumer reads through these views so one code path serves both, and a
 * rollback to a pre-cutover selection executes exactly as frozen (P2).
 */

type Stored = StoredRecipeDefinition;
type KubernetesRecipe = Extract<
  RecipeDefinition,
  { kind: "kubernetes-application" }
>;

/** The Application a recipe deploys through. */
export type ApplicationView = {
  name: string;
  namespace: string;
  /** Chart repository, OCI repository, or Git repository. */
  repository: string;
  /** Null for a Git path source. */
  chart: string | null;
  /** Git path; null for a chart source. */
  path: string | null;
  /** The component whose artifact fixes the source revision. */
  chartComponent: string;
  artifactParameters: Record<string, ArtifactParameter>;
  /** Helm values a v1 pipeline carried in the recipe; configuration overrides them. */
  legacyParameters: Record<string, string>;
  project: string;
  /** The full body a model recipe declares; null for a v1 pipeline. */
  body: ApplicationBody | null;
};

function modelApplication(recipe: KubernetesRecipe): ApplicationView {
  const source = recipe.application.source;
  const helm = helmSource(source);
  return {
    name: recipe.application.name,
    namespace: recipe.application.destination.namespace,
    repository: source.repoURL,
    chart: helm?.chart ?? null,
    path: "path" in source ? source.path : null,
    chartComponent: recipe.chartComponent,
    artifactParameters: recipe.artifactParameters,
    legacyParameters: {},
    project: recipe.application.project,
    body: recipe.application,
  };
}

/** Kubernetes-application recipes a definition contains, in step order. */
export function kubernetesRecipes(definition: Stored): KubernetesRecipe[] {
  switch (definition.kind) {
    case "kubernetes-application":
      return [definition];
    case "operator-run":
      return definition.wrapped.kind === "kubernetes-application"
        ? [definition.wrapped]
        : [];
    case "compound":
      return definition.subRecipes.flatMap((sub) =>
        kubernetesRecipes(sub.definition),
      );
    case "argocd":
    case "control-plane":
    case "root-release":
    case "static-site":
    case "tofu":
    case "manual":
    case "channel":
      return [];
  }
}

/**
 * The Application ArgoCD may self-heal on the accepted exact source after
 * acceptance (T4). The adapter decides, never the recipe: only a
 * kubernetes-application recipe of a service that is not self-hosted. A
 * data-layer recipe is operator-run and never self-heals.
 */
export function selfHealingApplication(
  definition: Stored,
  service: { selfHosted: boolean },
): ApplicationBody | null {
  return definition.kind === "kubernetes-application" && !service.selfHosted
    ? definition.application
    : null;
}

/**
 * What a deployment of a stored recipe becomes (section 5). A v1 pipeline
 * maps onto the model kind that replaces it; a v1 manual pipeline was
 * operated outside Delivery.
 */
export function recipeKindOf(definition: Stored): RecipeDefinition["kind"] {
  switch (definition.kind) {
    case "argocd":
    case "control-plane":
    case "root-release":
      return "kubernetes-application";
    case "manual":
      return "operator-run";
    case "kubernetes-application":
    case "static-site":
    case "tofu":
    case "channel":
    case "operator-run":
    case "compound":
      return definition.kind;
  }
}

/** Every Application a recipe deploys through, in step order. */
export function applicationsOf(definition: Stored): ApplicationView[] {
  switch (definition.kind) {
    case "argocd":
      return [
        {
          name: definition.application,
          namespace: definition.namespace ?? definition.application,
          repository: definition.chartRepository,
          chart: definition.chartName,
          path: null,
          chartComponent: definition.chartComponent,
          artifactParameters: referenceParameters(
            definition.artifactParameters,
          ),
          legacyParameters: definition.parameters,
          project: "default",
          body: null,
        },
      ];
    case "control-plane":
      return [
        {
          name: definition.application,
          namespace: definition.namespace,
          repository: definition.chartRepository,
          chart: definition.chartName,
          path: null,
          chartComponent: definition.chartComponent,
          artifactParameters: {},
          legacyParameters: {},
          project: "default",
          body: null,
        },
      ];
    case "kubernetes-application":
    case "operator-run":
    case "compound":
    case "root-release":
    case "static-site":
    case "tofu":
    case "manual":
    case "channel":
      return kubernetesRecipes(definition).map((recipe) =>
        modelApplication(recipe),
      );
  }
}

/** The recipe's first Application, or null when it deploys none. */
export function applicationOf(definition: Stored): ApplicationView | null {
  return applicationsOf(definition)[0] ?? null;
}

function stepsOf(definition: Stored): KubernetesStep[] {
  return kubernetesRecipes(definition).flatMap((recipe) => recipe.steps);
}

function firstStep(definition: Stored, kind: KubernetesStep["kind"]) {
  return stepsOf(definition).find((candidate) => candidate.kind === kind);
}

/** The worker pool a recipe rolls an image onto (v1 `workerRollout`). */
export function workerRolloutOf(
  definition: Stored,
): { target: WorkerPoolTarget; imageComponent: string } | undefined {
  if (definition.kind === "argocd") return definition.workerRollout;
  const rollout = firstStep(definition, "worker-rollout");
  return rollout?.kind === "worker-rollout"
    ? { target: rollout.target, imageComponent: rollout.imageComponent }
    : undefined;
}

/** The site an Application release also activates (v1 `scoutSite`). */
export function siteReleaseOf(
  definition: Stored,
): StaticSitePolicy | undefined {
  if (definition.kind === "argocd") return definition.scoutSite;
  const site = firstStep(definition, "static-site");
  return site?.kind === "static-site" ? site.policy : undefined;
}

/** The Forum image and licensed bundle a release migrates to (v1 `forumRelease`). */
export function forumReleaseOf(
  definition: Stored,
): { imageComponent: string; bundleComponent: string } | undefined {
  if (definition.kind === "argocd") return definition.forumRelease;
  const forum = firstStep(definition, "forum-bundle");
  return forum?.kind === "forum-bundle"
    ? {
        imageComponent: forum.imageComponent,
        bundleComponent: forum.bundleComponent,
      }
    : undefined;
}

/** The preserved Minecraft world upgrade (v1 `minecraftUpgrade`). */
export function minecraftUpgradeOf(definition: Stored):
  | {
      imageComponent: string;
      releaseMode: "verified-restore" | "retained-volume-restart";
    }
  | undefined {
  if (definition.kind === "argocd") {
    const upgrade = definition.minecraftUpgrade;
    return upgrade === undefined
      ? undefined
      : {
          imageComponent: upgrade.imageComponent,
          releaseMode: upgrade.releaseMode ?? "verified-restore",
        };
  }
  const upgrade = firstStep(definition, "minecraft-upgrade");
  return upgrade?.kind === "minecraft-upgrade"
    ? {
        imageComponent: upgrade.imageComponent,
        releaseMode: upgrade.releaseMode,
      }
    : undefined;
}

/** The plugin archive an Application release also publishes (v1 `trmnlPlugins`). */
export function trmnlPluginsOf(
  definition: Stored,
): { archiveComponent: string } | undefined {
  if (definition.kind === "argocd") return definition.trmnlPlugins;
  const archive = firstStep(definition, "archive");
  return archive?.kind === "archive"
    ? { archiveComponent: archive.archiveComponent }
    : undefined;
}

/** Probes the oracle requires after reconciliation (v1 `verification`). */
export function probesOf(
  definition: Stored,
): { url: string; expectedStatus: number }[] {
  if (definition.kind === "argocd")
    return definition.verification === undefined
      ? []
      : [definition.verification];
  return kubernetesRecipes(definition).flatMap(
    (recipe) => recipe.oracle.probes,
  );
}

/** Steps past which a rollback cannot reselect bytes (D9). */
export function pointsOfNoReturn(definition: Stored): string[] {
  if (definition.kind === "argocd")
    return [
      ...(definition.forumRelease === undefined ? [] : ["forum-bundle"]),
      ...(definition.minecraftUpgrade === undefined
        ? []
        : ["minecraft-upgrade"]),
    ];
  return definition.kind === "compound"
    ? definition.subRecipes.flatMap((sub) =>
        sub.pointOfNoReturn ? [sub.instance] : pointsOfNoReturn(sub.definition),
      )
    : stepsOf(definition)
        .filter((candidate) => candidate.pointOfNoReturn)
        .map((candidate) => candidate.kind);
}

/** The monitor a recipe's oracle declares, or null when it settles on acceptance (W1). */
export function monitorOf(definition: Stored): Monitor | null {
  for (const recipe of kubernetesRecipes(definition))
    if (recipe.oracle.monitor !== undefined) return recipe.oracle.monitor;
  return null;
}

/** A v1 runner digest literal; model recipes bind runners by reference (C2). */
export function legacyRunnerImage(definition: Stored): string | undefined {
  switch (definition.kind) {
    case "control-plane":
    case "root-release":
      return definition.runnerImage;
    case "tofu":
      return "runnerImage" in definition ? definition.runnerImage : undefined;
    case "argocd":
      return (
        definition.workerRollout?.runnerImage ??
        definition.minecraftUpgrade?.runnerImage
      );
    case "static-site":
    case "manual":
    case "kubernetes-application":
    case "channel":
    case "operator-run":
    case "compound":
      return undefined;
  }
}
