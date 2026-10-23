import { z } from "zod";
import {
  AppProjectNameSchema,
  ArchiveComponentNameSchema,
  ChartComponentNameSchema,
  ImageComponentNameSchema,
  ServiceIdSchema,
} from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import { IdentifierSchema } from "#shared/artifact-contract.ts";
import { MonitorSchema } from "./monitor-contract.ts";
import { StaticSitePolicySchema } from "#shared/static-site-contract.ts";
import { WorkerPoolTargetSchema } from "#shared/worker-contract.ts";
import { misplacedUpgrades, contentStepRefusals } from "./step-order.ts";
import { OperatorHostTargetSchema } from "./operator-run-contract.ts";

/**
 * Recipe (model 4.7): an immutable, target-typed description of how one
 * environment realises a selection. Section 5 lists the kinds. Runner images
 * are bound by component reference (A5, C2), never by digest literal.
 * `recipe-adapter.ts` maps v1 pipeline definitions onto these shapes.
 */

/** A lock instance a step acts on (T1): `<scope>:<name>`. */
export const TargetInstanceSchema = z
  .string()
  .regex(
    /^(?:application|bucket|stack|channel|worker-pool):[a-z0-9][\w.:/@-]*$/u,
  );
/** A component of another service that the recipe binds by reference (A5). */
export const RunnerReferenceSchema = z.strictObject({
  service: ServiceIdSchema,
  component: ImageComponentNameSchema,
});
export type RunnerReference = z.infer<typeof RunnerReferenceSchema>;

const KubernetesNameSchema = z
  .string()
  .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u)
  .max(253);
const StringMapSchema = z.record(z.string().min(1), z.string());
/** An OCI Helm repository named without a scheme, as ArgoCD accepts it (`registry.k8s.io/kueue/charts`). */
export const OciRepositorySchema = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(?::\d+)?(?:\/[a-z0-9._-]+)+$/u);
const HttpsUrlSchema = z.url({ protocol: /^https$/u });
/** A Helm chart from an HTTPS or OCI repository; the chart artifact binds its revision. */
export const HelmSourceSchema = z.strictObject({
  repoURL: z.union([HttpsUrlSchema, OciRepositorySchema]),
  chart: IdentifierSchema,
  helm: z
    .strictObject({
      releaseName: KubernetesNameSchema.optional(),
      skipCrds: z.boolean().optional(),
      valueFiles: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});
export type HelmSource = z.infer<typeof HelmSourceSchema>;
/**
 * A path in a Git repository (kustomize or plain manifests). Its revision is
 * never a literal (C2): an acquired archive component's version, the exact
 * commit, binds it.
 */
export const GitSourceSchema = z.strictObject({
  repoURL: HttpsUrlSchema,
  path: z.string().min(1),
});
export type GitSource = z.infer<typeof GitSourceSchema>;
/** The Helm form of an Application source, or null for a Git source. */
export function helmSource(source: HelmSource | GitSource): HelmSource | null {
  const parsed = HelmSourceSchema.safeParse(source);
  return parsed.success ? parsed.data : null;
}
/**
 * The whole Application except the fields a deployment binds: the source
 * revision comes from the chart (or Git revision) artifact and Helm values
 * from `artifactParameters` plus the configuration revision.
 */
export const ApplicationBodySchema = z.strictObject({
  name: KubernetesNameSchema,
  metadata: z
    .strictObject({
      labels: StringMapSchema.default({}),
      annotations: StringMapSchema.default({}),
      finalizers: z.array(z.string().min(1)).default([]),
    })
    .default({ labels: {}, annotations: {}, finalizers: [] }),
  project: AppProjectNameSchema,
  destination: z.strictObject({
    server: z.url(),
    namespace: KubernetesNameSchema,
  }),
  source: z.union([HelmSourceSchema, GitSourceSchema]),
  // No syncPolicy: whether ArgoCD self-heals the accepted exact source is the
  // adapter's decision (T4), never the recipe's.
  syncOptions: z.array(z.string().min(1)).default([]),
  ignoreDifferences: z
    .array(
      z.strictObject({
        group: z.string().optional(),
        kind: z.string().min(1),
        name: z.string().optional(),
        namespace: z.string().optional(),
        jsonPointers: z.array(z.string().min(1)).optional(),
        jqPathExpressions: z.array(z.string().min(1)).optional(),
        managedFieldsManagers: z.array(z.string().min(1)).optional(),
      }),
    )
    .default([]),
  revisionHistoryLimit: z.number().int().nonnegative().optional(),
  /** What deleting the Application does to its resources. */
  lifecycle: z.enum(["retain", "cascade"]),
});
export type ApplicationBody = z.infer<typeof ApplicationBodySchema>;

/**
 * The literal shape a Helm value receives from an image artifact. Closed: a
 * new shape a chart needs gets its own named member.
 * - `reference`: `<uri>@<digest>`, a complete image reference.
 * - `tag-digest`: `<version>@<digest>`, for a `.tag` path whose chart
 *   prefixes its own repository.
 * - `selected-digest`: `selected@<digest>`, for a tag whose version string
 *   carries no meaning (openebs's zfs-driver plugin).
 */
export const ArtifactParameterFormatSchema = z.enum([
  "reference",
  "tag-digest",
  "selected-digest",
]);
export type ArtifactParameterFormat = z.infer<
  typeof ArtifactParameterFormatSchema
>;
/**
 * What fills one Helm value path: an image component of the deployment's
 * own selection, rendered in a named format. Another environment's
 * accepted artifact is bound by a tracking reference component of the
 * service (A5), which composition fills and an acceptance there recomposes
 * (R7); the parameter names that component like any other.
 */
export const ArtifactParameterSchema = z.strictObject({
  component: ImageComponentNameSchema,
  format: ArtifactParameterFormatSchema,
});
export type ArtifactParameter = z.infer<typeof ArtifactParameterSchema>;
export function artifactParameterComponent(value: ArtifactParameter): string {
  return value.component;
}
/** v1 pipelines rendered every artifact parameter as a complete reference. */
export function referenceParameters(
  parameters: Readonly<Record<string, string>>,
): Record<string, ArtifactParameter> {
  return Object.fromEntries(
    Object.entries(parameters).map(([path, component]) => [
      path,
      { component, format: "reference" as const },
    ]),
  );
}
/** The value a Helm path receives from the artifact, in the parameter's format. */
export function renderArtifactParameter(
  format: ArtifactParameterFormat,
  artifact: { uri: string; version: string; digest: string },
): string {
  switch (format) {
    case "reference":
      return `${artifact.uri}@${artifact.digest}`;
    case "tag-digest":
      return `${artifact.version}@${artifact.digest}`;
    case "selected-digest":
      return `selected@${artifact.digest}`;
  }
}

const stepFields = {
  instance: TargetInstanceSchema,
  pointOfNoReturn: z.boolean().default(false),
};
export const StaticSiteStepPolicySchema = StaticSitePolicySchema.extend({
  archiveComponent: ArchiveComponentNameSchema,
});
export const MinecraftReleaseModeSchema = z.enum([
  "verified-restore",
  "retained-volume-restart",
]);
/** Ordered sub-steps of a `kubernetes-application` recipe (T3). */
export const KubernetesStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("apply-safety"), ...stepFields }),
  z.strictObject({ kind: z.literal("sync"), ...stepFields }),
  z.strictObject({
    kind: z.literal("worker-rollout"),
    ...stepFields,
    target: WorkerPoolTargetSchema,
    imageComponent: ImageComponentNameSchema,
  }),
  z.strictObject({
    kind: z.literal("static-site"),
    ...stepFields,
    policy: StaticSiteStepPolicySchema,
  }),
  z.strictObject({
    kind: z.literal("archive"),
    ...stepFields,
    archiveComponent: ArchiveComponentNameSchema,
  }),
  z.strictObject({
    kind: z.literal("forum-bundle"),
    ...stepFields,
    imageComponent: ImageComponentNameSchema,
    bundleComponent: ArchiveComponentNameSchema,
  }),
  z.strictObject({
    kind: z.literal("minecraft-upgrade"),
    ...stepFields,
    imageComponent: ImageComponentNameSchema,
    releaseMode: MinecraftReleaseModeSchema,
  }),
]);
export type KubernetesStep = z.infer<typeof KubernetesStepSchema>;

export const ProbeSchema = z.strictObject({
  url: z.url(),
  expectedStatus: z.number().int().min(200).max(299),
});
export const OracleSchema = z.strictObject({
  probes: z.array(ProbeSchema).default([]),
  /** Suites run as deployment stages on the CI node; the JSON report is `test` evidence (V5). */
  tests: z
    .array(
      z.strictObject({
        suite: IdentifierSchema,
        resultPath: z.string().min(1),
      }),
    )
    .default([]),
  monitor: MonitorSchema.optional(),
});

function stepInstanceExpectation(
  step: KubernetesStep,
  application: string,
): string {
  switch (step.kind) {
    case "worker-rollout":
      return `worker-pool:${step.target}`;
    case "static-site":
      return `bucket:${step.policy.bucket}`;
    case "apply-safety":
    case "sync":
    case "archive":
    case "forum-bundle":
    case "minecraft-upgrade":
      return application;
  }
}

export function stepComponents(step: KubernetesStep): string[] {
  switch (step.kind) {
    case "worker-rollout":
    case "minecraft-upgrade":
      return [step.imageComponent];
    case "static-site":
      return [step.policy.archiveComponent];
    case "archive":
      return [step.archiveComponent];
    case "forum-bundle":
      return [step.imageComponent, step.bundleComponent];
    case "apply-safety":
    case "sync":
      return [];
  }
}

export const KubernetesApplicationRecipeSchema = z
  .strictObject({
    kind: z.literal("kubernetes-application"),
    application: ApplicationBodySchema,
    /**
     * The component whose artifact fixes the source revision: `chart:<chart>`
     * for a Helm source, an archive of the exact commit for a Git source.
     */
    chartComponent: z.union([
      ChartComponentNameSchema,
      ArchiveComponentNameSchema,
    ]),
    /** Helm value path to what fills it; rendered by the path's form. */
    artifactParameters: z
      .record(z.string().min(1), ArtifactParameterSchema)
      .default({}),
    runner: RunnerReferenceSchema,
    steps: z.array(KubernetesStepSchema).min(2),
    sharedLock: z.literal("platform").optional(),
    oracle: OracleSchema,
  })
  .superRefine((recipe, context) => {
    const application = `application:${recipe.application.name}`;
    const helm = helmSource(recipe.application.source);
    if (
      helm === null
        ? !recipe.chartComponent.startsWith("archive:")
        : recipe.chartComponent !== `chart:${helm.chart}`
    ) {
      context.addIssue({
        code: "custom",
        path: ["chartComponent"],
        message:
          "A Helm source binds the chart component of its chart; a Git source binds an archive of its revision",
      });
    }
    if (helm === null && Object.keys(recipe.artifactParameters).length > 0) {
      context.addIssue({
        code: "custom",
        path: ["artifactParameters"],
        message: "Artifact parameters are Helm values; a Git source takes none",
      });
    }
    const kinds = recipe.steps.map((step) => step.kind);
    const safety = kinds.indexOf("apply-safety");
    const sync = kinds.indexOf("sync");
    if (
      safety === -1 ||
      sync === -1 ||
      safety > sync ||
      kinds.filter((kind) => kind === "sync").length !== 1 ||
      kinds.filter((kind) => kind === "apply-safety").length !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message:
          "A kubernetes-application recipe runs exactly one apply-safety preflight before exactly one sync",
      });
    }
    for (const issue of misplacedUpgrades(recipe.steps))
      context.addIssue(issue);
    for (const message of contentStepRefusals(recipe.steps))
      context.addIssue({ code: "custom", path: ["steps"], message });
    // Steps and monitors act on this deployment's own selection only.
    const images = new Set(
      Object.values(recipe.artifactParameters).map((value) => value.component),
    );
    for (const [index, step] of recipe.steps.entries()) {
      const expected = stepInstanceExpectation(step, application);
      if (step.instance !== expected) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "instance"],
          message: `Step ${step.kind} acts on ${expected}`,
        });
      }
      if (
        (step.kind === "worker-rollout" || step.kind === "forum-bundle") &&
        !images.has(step.imageComponent)
      ) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "imageComponent"],
          message: `Step ${step.kind} must roll out an image bound by artifactParameters`,
        });
      }
    }
    const monitor = recipe.oracle.monitor;
    if (monitor !== undefined && !images.has(monitor.component)) {
      context.addIssue({
        code: "custom",
        path: ["oracle", "monitor", "component"],
        message: "The monitor observes an image bound by artifactParameters",
      });
    }
  });

export const StaticSiteRecipeSchema = StaticSiteStepPolicySchema.extend({
  kind: z.literal("static-site"),
});

export const TofuStepKindSchema = z.enum(["plan", "approve", "apply"]);
export const TofuRecipeSchema = z
  .strictObject({
    kind: z.literal("tofu"),
    stack: TofuStackSchema,
    archiveComponent: ArchiveComponentNameSchema,
    runner: RunnerReferenceSchema,
    steps: z
      .array(z.strictObject({ kind: TofuStepKindSchema, ...stepFields }))
      .min(2)
      .max(3),
    sharedLock: z.literal("platform"),
  })
  .superRefine((recipe, context) => {
    const kinds = recipe.steps.map((step) => step.kind).join(",");
    if (kinds !== "plan,apply" && kinds !== "plan,approve,apply") {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "A tofu recipe plans, optionally approves, then applies",
      });
    }
    for (const [index, step] of recipe.steps.entries()) {
      if (step.instance !== `stack:${recipe.stack}`) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "instance"],
          message: `Step ${step.kind} acts on stack:${recipe.stack}`,
        });
      }
    }
  });

export const ChannelStoreSchema = z.enum([
  "npm",
  "docker-hub",
  "obsidian-community",
  "feed",
  "testflight",
]);
export const ChannelRecipeSchema = z
  .strictObject({
    kind: z.literal("channel"),
    store: ChannelStoreSchema,
    /** The package, image, plugin or feed the store knows the artifact as. */
    name: z.string().min(1).max(200),
    /** The mutable pointer the channel moves: a dist-tag, a tag, a manifest or a feed channel. */
    pointer: z.string().min(1).max(100),
    /** A store with no mutable pointer; the deployment is the submission and D9 offers no rollback. */
    forwardOnly: z.boolean(),
    artifactComponent: z.union([
      ImageComponentNameSchema,
      ArchiveComponentNameSchema,
    ]),
  })
  .refine(
    (recipe) => recipe.store !== "testflight" || recipe.forwardOnly,
    "TestFlight has no mutable pointer and is forwardOnly",
  );

export const OperatorRunRecipeSchema = z
  .strictObject({
    kind: z.literal("operator-run"),
    /** What the operator tool executes, or a host it changes by hand. */
    wrapped: z.discriminatedUnion("kind", [
      KubernetesApplicationRecipeSchema,
      TofuRecipeSchema,
      OperatorHostTargetSchema,
    ]),
    /** The stages an operator attestation must cover before acceptance. */
    stages: z.array(IdentifierSchema).min(1),
  })
  .refine(
    (recipe) => new Set(recipe.stages).size === recipe.stages.length,
    "Attested stages must be unique",
  );

const nonCompoundRecipes = [
  KubernetesApplicationRecipeSchema,
  StaticSiteRecipeSchema,
  TofuRecipeSchema,
  ChannelRecipeSchema,
  OperatorRunRecipeSchema,
] as const;

/** The steps of the Application a non-compound recipe deploys, if any. */
function applicationSteps(
  definition: z.infer<(typeof nonCompoundRecipes)[number]>,
): readonly { kind: string }[] {
  if (definition.kind === "kubernetes-application") return definition.steps;
  const wrapped =
    definition.kind === "operator-run" ? definition.wrapped : null;
  return wrapped?.kind === "kubernetes-application" ? wrapped.steps : [];
}

export const CompoundRecipeSchema = z
  .strictObject({
    kind: z.literal("compound"),
    subRecipes: z
      .array(
        z.strictObject({
          ...stepFields,
          definition: z.discriminatedUnion("kind", [...nonCompoundRecipes]),
        }),
      )
      .min(2),
  })
  .refine(
    (recipe) =>
      new Set(recipe.subRecipes.map((sub) => sub.instance)).size ===
      recipe.subRecipes.length,
    "Each sub-recipe holds its own lock instance",
  )
  // A saved plan, its one plan-step approval (H6) and its apply bind one
  // deployment of one stack (D6), so a Tofu stack is always its own recipe.
  .refine(
    (recipe) =>
      recipe.subRecipes.every((sub) => sub.definition.kind !== "tofu"),
    "A Tofu stack is its own recipe; a compound recipe holds no tofu sub-recipe",
  )
  .superRefine((recipe, context) => {
    for (const message of contentStepRefusals(
      recipe.subRecipes.flatMap((sub) => applicationSteps(sub.definition)),
    ))
      context.addIssue({ code: "custom", message });
  });

export const RecipeDefinitionSchema = z.discriminatedUnion("kind", [
  ...nonCompoundRecipes,
  CompoundRecipeSchema,
]);
export type RecipeDefinition = z.infer<typeof RecipeDefinitionSchema>;
export type RecipeKind = RecipeDefinition["kind"];
