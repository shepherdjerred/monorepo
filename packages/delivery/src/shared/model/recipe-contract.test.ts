import { describe, expect, test } from "vitest";
import { PipelineDefinitionSchema } from "#shared/pipeline-contract.ts";
import { recipeFromPipeline } from "./recipe-adapter.ts";
import {
  ChannelRecipeSchema,
  CompoundRecipeSchema,
  helmSource,
  KubernetesApplicationRecipeSchema,
  OperatorRunRecipeSchema,
  RecipeDefinitionSchema,
  renderArtifactParameter,
  referenceParameters,
  TofuRecipeSchema,
} from "./recipe-contract.ts";
import {
  recipeComponents,
  recipeInstances,
  recipeRunners,
} from "./recipe-bindings.ts";
import { targetWithoutRemoval } from "./recipe-view.ts";

const runnerImage =
  "docker.io/shepherdjerred/ci-base@sha256:01851075993f5ebf500a8ea6abe1f3ebfb074a906412a63a3df4905e06ebdd50";
const digestLiteral = /sha256:[a-f0-9]{64}/u;

type Pipeline = ReturnType<typeof PipelineDefinitionSchema.parse>;
type ArgocdPipeline = Extract<Pipeline, { kind: "argocd" }>;

async function registrations() {
  const root = new URL("../../../registrations/", import.meta.url);
  const files = [
    "arcade.pipeline.json",
    ...new Bun.Glob("**/pipeline.json").scanSync({
      cwd: root.pathname,
      onlyFiles: true,
    }),
  ].toSorted();
  return Promise.all(
    files.map(async (file) => ({
      file,
      pipeline: PipelineDefinitionSchema.parse(
        await Bun.file(new URL(file, root)).json(),
      ),
    })),
  );
}

async function registered(file: string) {
  const definitions = await registrations();
  const match = definitions.find((definition) => definition.file === file);
  if (match === undefined) {
    throw new Error(`${file} is not registered`);
  }
  return match.pipeline;
}

function applicationBody(): Record<string, unknown> {
  return {
    name: "arcade",
    project: "default",
    destination: {
      server: "https://kubernetes.default.svc",
      namespace: "arcade",
    },
    source: {
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: "arcade",
    },
    lifecycle: "retain",
  };
}

function application(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "kubernetes-application",
    application: applicationBody(),
    chartComponent: "chart:arcade",
    artifactParameters: {
      "delivery.image": { component: "image:arcade", format: "reference" },
    },
    runner: { service: "ci", component: "image:ci-base" },
    steps: [
      { kind: "apply-safety", instance: "application:arcade" },
      { kind: "sync", instance: "application:arcade" },
    ],
    oracle: { probes: [] },
    ...overrides,
  };
}

const tofu = (stack: string) =>
  recipeFromPipeline(
    PipelineDefinitionSchema.parse({ kind: "tofu", stack, runnerImage }),
  );

const tofuSteps = (kinds: string[], instance = "stack:github") =>
  TofuRecipeSchema.safeParse({
    kind: "tofu",
    stack: "github",
    archiveComponent: "archive:tofu-github",
    runner: { service: "ci", component: "image:ci-base" },
    steps: kinds.map((kind) => ({ kind, instance })),
    sharedLock: "platform",
  });

function expectArgocdMapping(file: string, pipeline: ArgocdPipeline) {
  const recipe = recipeFromPipeline(pipeline);
  if (recipe.kind !== "kubernetes-application") {
    throw new Error(`${file} did not map to a kubernetes-application`);
  }
  expect(recipe.application.name, file).toBe(pipeline.application);
  expect(recipe.application.source, file).toMatchObject({
    chart: pipeline.chartName,
  });
  expect(recipe.chartComponent, file).toBe(pipeline.chartComponent);
  // v1 rendered every artifact parameter as a complete reference.
  expect(recipe.artifactParameters, file).toEqual(
    referenceParameters(pipeline.artifactParameters),
  );
  expect(recipe.runner, file).toEqual({
    service: "ci",
    component: "image:ci-base",
  });
  expect(
    recipe.steps.slice(0, 2).map((step) => step.kind),
    file,
  ).toEqual(["apply-safety", "sync"]);
  expect(recipe.oracle.probes, file).toEqual(
    pipeline.verification === undefined ? [] : [pipeline.verification],
  );
  const kinds = new Set(recipe.steps.map((step) => step.kind));
  expect(kinds.has("worker-rollout"), file).toBe(
    pipeline.workerRollout !== undefined,
  );
  expect(kinds.has("static-site"), file).toBe(pipeline.scoutSite !== undefined);
  expect(kinds.has("forum-bundle"), file).toBe(
    pipeline.forumRelease !== undefined,
  );
  expect(kinds.has("minecraft-upgrade"), file).toBe(
    pipeline.minecraftUpgrade !== undefined,
  );
  expect(kinds.has("archive"), file).toBe(pipeline.trmnlPlugins !== undefined);
}

function expectMapping(file: string, pipeline: Pipeline) {
  const recipe = recipeFromPipeline(pipeline);
  switch (pipeline.kind) {
    case "argocd":
      expectArgocdMapping(file, pipeline);
      break;
    case "static-site":
      expect(recipe, file).toMatchObject({
        kind: "static-site",
        bucket: pipeline.bucket,
        archiveComponent: `archive:${pipeline.bucket}`,
      });
      break;
    case "control-plane":
      expect(recipe, file).toMatchObject({
        kind: "kubernetes-application",
        application: { name: "delivery-control-plane" },
        sharedLock: "platform",
      });
      break;
    case "root-release":
      expect(recipe, file).toMatchObject({
        kind: "kubernetes-application",
        application: { name: "apps", destination: { namespace: "argocd" } },
        chartComponent: "chart:apps",
        sharedLock: "platform",
      });
      break;
    case "tofu":
    case "manual":
      throw new Error(`${file} registers a ${pipeline.kind} pipeline`);
  }
}

describe("recipeFromPipeline", () => {
  test("maps every reviewed registration onto a recipe with no digest literal", async () => {
    const definitions = await registrations();
    // Shared-site and root registrations are retired (X4, X6).
    expect(definitions).toHaveLength(19);
    for (const { file, pipeline } of definitions) {
      const recipe = recipeFromPipeline(pipeline);
      expect(RecipeDefinitionSchema.parse(recipe), file).toEqual(recipe);
      const serialised = JSON.stringify(recipe);
      expect(serialised, file).not.toMatch(digestLiteral);
      expect(serialised, file).not.toContain('"site:');
      for (const component of recipeComponents(recipe)) {
        expect(component, file).toMatch(/^(?:image|chart|archive):/u);
      }
      expectMapping(file, pipeline);
    }
  });

  test("Scout carries the worker rollout and the renamed site archive as ordered steps", async () => {
    const recipe = recipeFromPipeline(
      await registered("specialized/scout-prod/pipeline.json"),
    );
    expect(recipe).toMatchObject({
      kind: "kubernetes-application",
      steps: [
        { kind: "apply-safety", instance: "application:scout-prod" },
        { kind: "sync", instance: "application:scout-prod" },
        {
          kind: "worker-rollout",
          instance: "worker-pool:scout-prod",
          target: "scout-prod",
          imageComponent: "image:scout-for-lol",
        },
        {
          kind: "static-site",
          instance: "bucket:scout-frontend",
          policy: { archiveComponent: "archive:scout-frontend" },
        },
      ],
    });
    expect(recipeComponents(recipe).toSorted()).toEqual([
      "archive:scout-frontend",
      "chart:scout-prod",
      "image:scout-for-lol",
    ]);
    expect(recipeRunners(recipe)).toEqual([
      { service: "ci", component: "image:ci-base" },
    ]);
    expect(recipeInstances(recipe)).toEqual([
      "application:scout-prod",
      "worker-pool:scout-prod",
      "bucket:scout-frontend",
    ]);
  });

  test("Minecraft and Forum mark their points of no return", async () => {
    expect(
      recipeFromPipeline(
        await registered("specialized/minecraft-tsmc/pipeline.json"),
      ),
    ).toMatchObject({
      steps: [
        {},
        {},
        {
          kind: "minecraft-upgrade",
          pointOfNoReturn: true,
          releaseMode: "retained-volume-restart",
        },
      ],
    });
    expect(
      recipeFromPipeline(
        await registered("specialized/storm-forum/pipeline.json"),
      ),
    ).toMatchObject({
      steps: [
        {},
        {},
        {
          kind: "forum-bundle",
          pointOfNoReturn: true,
          bundleComponent: "archive:forum-bundle",
        },
      ],
    });
  });

  test("a minecraft upgrade reads the retained volume back after sync", async () => {
    const tsmc = await registered("specialized/minecraft-tsmc/pipeline.json");
    if (tsmc.kind !== "argocd" || tsmc.minecraftUpgrade === undefined)
      throw new Error("TSMC registers a Minecraft upgrade");
    const verified = recipeFromPipeline({
      ...tsmc,
      minecraftUpgrade: {
        ...tsmc.minecraftUpgrade,
        releaseMode: "verified-restore",
      },
    });
    if (verified.kind !== "kubernetes-application")
      throw new Error("TSMC maps onto an Application recipe");
    expect(verified.steps.map((step) => step.kind)).toEqual([
      "apply-safety",
      "sync",
      "minecraft-upgrade",
    ]);
    const misplaced = {
      ...verified,
      steps: [verified.steps[0], verified.steps[2], verified.steps[1]],
    };
    expect(RecipeDefinitionSchema.safeParse(misplaced).error?.issues).toEqual([
      expect.objectContaining({
        message:
          "A minecraft-upgrade runs after sync and reads back the retained volume",
      }),
    ]);
  });

  test("maps Tofu stacks by their reviewed policy mode", () => {
    expect(tofu("github")).toMatchObject({
      kind: "tofu",
      archiveComponent: "archive:tofu-github",
      sharedLock: "platform",
      steps: [
        { kind: "plan", instance: "stack:github" },
        { kind: "apply", instance: "stack:github" },
      ],
    });
    expect(tofu("anthropic")).toMatchObject({
      kind: "tofu",
      steps: [{ kind: "plan" }, { kind: "approve" }, { kind: "apply" }],
    });
    expect(tofu("argocd")).toMatchObject({
      kind: "operator-run",
      wrapped: { kind: "tofu", stack: "argocd" },
      stages: ["plan", "apply"],
    });
    expect(() => tofu("application-secrets")).toThrow(/validate-only/u);
  });

  test("refuses definitions the model has no place for", () => {
    expect(() =>
      recipeFromPipeline(
        PipelineDefinitionSchema.parse({ kind: "manual", reason: "paused" }),
      ),
    ).toThrow(/no recipe counterpart/u);
    expect(() =>
      recipeFromPipeline(
        PipelineDefinitionSchema.parse({
          kind: "argocd",
          application: "arcade",
          chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
          chartName: "arcade",
          chartComponent: "chart:arcade",
          parameters: { replicas: "2" },
          artifactParameters: {},
        }),
      ),
    ).toThrow(/configuration \(P4\)/u);
  });
});

describe("RecipeDefinitionSchema", () => {
  test("accepts a kubernetes-application with a monitor over a bound image", () => {
    const recipe = KubernetesApplicationRecipeSchema.parse(
      application({
        oracle: {
          probes: [
            { url: "https://arcade.sjer.red/health", expectedStatus: 200 },
          ],
          monitor: {
            component: "image:arcade",
            alarms: { matchers: { environment: "prod" } },
            evidence: [
              { key: "requests", query: "sum(rate(x[$window]))", threshold: 5 },
            ],
            policy: "hold",
          },
        },
      }),
    );
    expect(recipe.steps.every((step) => !step.pointOfNoReturn)).toBe(true);
    expect(recipe.application.metadata).toEqual({
      labels: {},
      annotations: {},
      finalizers: [],
    });
  });

  test.each([
    [
      "a sync without the apply-safety preflight",
      { steps: [{ kind: "sync", instance: "application:arcade" }] },
      /exactly one apply-safety preflight before exactly one sync/u,
    ],
    [
      "an apply-safety step after the sync",
      {
        steps: [
          { kind: "apply-safety", instance: "application:arcade" },
          { kind: "sync", instance: "application:arcade" },
          { kind: "apply-safety", instance: "application:arcade" },
        ],
      },
      /exactly one apply-safety preflight before exactly one sync/u,
    ],
    [
      "two apply-safety preflights",
      {
        steps: [
          { kind: "apply-safety", instance: "application:arcade" },
          { kind: "apply-safety", instance: "application:arcade" },
          { kind: "sync", instance: "application:arcade" },
        ],
      },
      /exactly one apply-safety preflight before exactly one sync/u,
    ],
    [
      "a step on another instance",
      {
        steps: [
          { kind: "apply-safety", instance: "application:arcade" },
          { kind: "sync", instance: "application:other" },
        ],
      },
      /acts on application:arcade/u,
    ],
    [
      "a chart component that is not the source chart",
      { chartComponent: "chart:other" },
      /A Helm source binds the chart component of its chart/u,
    ],
    [
      "a Git source bound to a chart component",
      {
        application: {
          ...applicationBody(),
          source: {
            repoURL: "https://github.com/adyanth/cloudflare-operator.git",
            path: "config/default",
          },
        },
        chartComponent: "chart:arcade",
        artifactParameters: {},
      },
      /a Git source binds an archive of its revision/u,
    ],
    [
      "Helm values on a Git source",
      {
        application: {
          ...applicationBody(),
          source: {
            repoURL: "https://github.com/adyanth/cloudflare-operator.git",
            path: "config/default",
          },
        },
        chartComponent: "archive:cloudflare-operator",
      },
      /a Git source takes none/u,
    ],
    [
      "a sync policy, which is the adapter's decision (T4)",
      {
        application: {
          ...applicationBody(),
          syncPolicy: { automated: { selfHeal: true, prune: false } },
        },
      },
      /Unrecognized key/u,
    ],
    [
      "an artifact parameter in an unnamed format",
      {
        artifactParameters: {
          "delivery.image": { component: "image:arcade", format: "tag" },
        },
      },
      /Invalid option/u,
    ],
    [
      "an artifact parameter that names an environment",
      {
        artifactParameters: {
          "delivery.image": {
            component: "image:arcade",
            format: "reference",
            acceptedIn: "arcade/beta",
          },
        },
      },
      /Unrecognized key/u,
    ],
    [
      "a monitor over an unbound image",
      {
        oracle: {
          monitor: {
            component: "image:other",
            alarms: { matchers: { environment: "prod" } },
            evidence: [{ key: "k", query: "up", threshold: 1 }],
            policy: "automatic",
          },
        },
      },
      /monitor observes an image bound by artifactParameters/u,
    ],
    [
      "a runner bound by digest",
      { runner: { service: "ci", component: runnerImage } },
      /Invalid string/u,
    ],
    [
      "a worker rollout of an unbound image",
      {
        steps: [
          { kind: "apply-safety", instance: "application:arcade" },
          { kind: "sync", instance: "application:arcade" },
          {
            kind: "worker-rollout",
            instance: "worker-pool:central",
            target: "central",
            imageComponent: "image:temporal-worker",
          },
        ],
      },
      /roll out an image bound by artifactParameters/u,
    ],
  ])("refuses %s", (_name, overrides, message) => {
    const result = KubernetesApplicationRecipeSchema.safeParse(
      application(overrides),
    );
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((issue) => issue.message).join("\n"),
    ).toMatch(message);
  });
});

describe("RecipeDefinitionSchema source forms", () => {
  test("accepts a scheme-less OCI chart repository and a Git path source", () => {
    const oci = KubernetesApplicationRecipeSchema.parse(
      application({
        application: {
          ...applicationBody(),
          name: "kueue",
          source: { repoURL: "registry.k8s.io/kueue/charts", chart: "kueue" },
        },
        chartComponent: "chart:kueue",
        artifactParameters: {},
        steps: [
          { kind: "apply-safety", instance: "application:kueue" },
          { kind: "sync", instance: "application:kueue" },
        ],
      }),
    );
    expect(oci.application.source).toEqual({
      repoURL: "registry.k8s.io/kueue/charts",
      chart: "kueue",
    });
    const git = KubernetesApplicationRecipeSchema.parse(
      application({
        application: {
          ...applicationBody(),
          source: {
            repoURL: "https://github.com/adyanth/cloudflare-operator.git",
            path: "config/default",
          },
        },
        chartComponent: "archive:cloudflare-operator",
        artifactParameters: {},
      }),
    );
    expect(helmSource(git.application.source)).toBeNull();
    const sandbox = KubernetesApplicationRecipeSchema.parse(
      application({
        artifactParameters: {
          "delivery.images.candidate": {
            component: "image:arcade",
            format: "reference",
          },
          "delivery.images.accepted": {
            component: "image:arcade-accepted",
            format: "reference",
          },
        },
      }),
    );
    expect(recipeComponents(sandbox)).toEqual([
      "chart:arcade",
      "image:arcade",
      "image:arcade-accepted",
    ]);
    expect(
      KubernetesApplicationRecipeSchema.safeParse(
        application({
          application: {
            ...applicationBody(),
            source: { repoURL: "http://charts.example.com", chart: "arcade" },
          },
        }),
      ).success,
    ).toBe(false);
  });

  test("renders an artifact parameter in each named format", () => {
    const artifact = {
      uri: "docker.io/shepherdjerred/zfs-driver",
      version: "2.8.0",
      digest: `sha256:${"a".repeat(64)}`,
    };
    expect(renderArtifactParameter("reference", artifact)).toBe(
      `docker.io/shepherdjerred/zfs-driver@sha256:${"a".repeat(64)}`,
    );
    expect(renderArtifactParameter("tag-digest", artifact)).toBe(
      `2.8.0@sha256:${"a".repeat(64)}`,
    );
    expect(renderArtifactParameter("selected-digest", artifact)).toBe(
      `selected@sha256:${"a".repeat(64)}`,
    );
  });
});

describe("RecipeDefinitionSchema target kinds", () => {
  test("tofu plans before it applies on its own stack", () => {
    expect(tofuSteps(["plan", "apply"]).success).toBe(true);
    expect(tofuSteps(["plan", "approve", "apply"]).success).toBe(true);
    expect(tofuSteps(["apply", "plan"]).success).toBe(false);
    expect(tofuSteps(["plan", "apply"], "stack:tailscale").success).toBe(false);
  });

  test("channel, operator-run and compound recipes carry their invariants", () => {
    const channel = {
      kind: "channel",
      store: "npm",
      name: "@shepherdjerred/webring",
      pointer: "latest",
      forwardOnly: false,
      artifactComponent: "archive:webring-package",
    };
    expect(ChannelRecipeSchema.safeParse(channel).success).toBe(true);
    expect(
      ChannelRecipeSchema.safeParse({ ...channel, store: "testflight" })
        .success,
    ).toBe(false);
    expect(
      ChannelRecipeSchema.safeParse({
        ...channel,
        store: "testflight",
        forwardOnly: true,
      }).success,
    ).toBe(true);
    const operatorRun = {
      kind: "operator-run",
      wrapped: application(),
      stages: ["apply-safety", "sync", "admission-canary"],
    };
    expect(OperatorRunRecipeSchema.safeParse(operatorRun).success).toBe(true);
    expect(
      OperatorRunRecipeSchema.safeParse({
        ...operatorRun,
        stages: ["sync", "sync"],
      }).success,
    ).toBe(false);
    // On its own (X13): a host the operator upgrades by hand, no Application.
    const host = OperatorRunRecipeSchema.parse({
      kind: "operator-run",
      wrapped: {
        kind: "host",
        instance: "host:liskov",
        components: ["image:installer", "image:kubelet"],
      },
      stages: ["talos-upgrade", "kubernetes-upgrade"],
    });
    expect(recipeComponents(host)).toEqual([
      "image:installer",
      "image:kubelet",
    ]);
    expect(recipeInstances(host)).toEqual(["host:liskov"]);
    expect(recipeRunners(host)).toEqual([]);
    for (const wrapped of [
      { kind: "host", instance: "application:liskov", components: ["image:a"] },
      { kind: "host", instance: "host:liskov", components: [] },
      { kind: "host", instance: "host:liskov", components: ["chart:a"] },
      {
        kind: "host",
        instance: "host:liskov",
        components: ["image:a", "image:a"],
      },
    ])
      expect(
        OperatorRunRecipeSchema.safeParse({ ...operatorRun, wrapped }).success,
      ).toBe(false);
    const compound = {
      kind: "compound",
      subRecipes: [
        { instance: "application:arcade", definition: application() },
        {
          instance: "channel:npm/@shepherdjerred/webring",
          pointOfNoReturn: true,
          definition: channel,
        },
      ],
    };
    const parsed = CompoundRecipeSchema.parse(compound);
    expect(recipeComponents(parsed).toSorted()).toEqual([
      "archive:webring-package",
      "chart:arcade",
      "image:arcade",
    ]);
    expect(recipeInstances(parsed)).toEqual([
      "application:arcade",
      "channel:npm/@shepherdjerred/webring",
    ]);
    expect(
      CompoundRecipeSchema.safeParse({
        ...compound,
        subRecipes: [compound.subRecipes[0], compound.subRecipes[0]],
      }).success,
    ).toBe(false);
  });
});

test("a Tofu stack is its own recipe, never a compound sub-recipe (D6, H6)", () => {
  const parsed = CompoundRecipeSchema.safeParse({
    kind: "compound",
    subRecipes: [
      { instance: "application:arcade", definition: application() },
      { instance: "stack:github", definition: tofu("github") },
    ],
  });
  expect(parsed.success).toBe(false);
  expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
    "A Tofu stack is its own recipe; a compound recipe holds no tofu sub-recipe",
  );
});

test("only a Kubernetes Application has a removal adapter (4.10)", () => {
  const kubernetes = KubernetesApplicationRecipeSchema.parse(application());
  const channel = ChannelRecipeSchema.parse({
    kind: "channel",
    store: "npm",
    name: "@shepherdjerred/webring",
    pointer: "latest",
    forwardOnly: false,
    artifactComponent: "archive:webring-package",
  });
  const site = recipeFromPipeline(
    PipelineDefinitionSchema.parse({
      kind: "static-site",
      bucket: "sjer-red",
      archiveComponent: "site:sjer-red",
      immutablePrefixes: [],
      extraExcludes: [],
      entrypoints: ["index.html"],
      verification: { url: "https://sjer.red", expectedStatus: 200 },
    }),
  );
  const host = OperatorRunRecipeSchema.parse({
    kind: "operator-run",
    wrapped: {
      kind: "host",
      instance: "host:liskov",
      components: ["image:installer"],
    },
    stages: ["talos-upgrade"],
  });
  const wrappedApplication = OperatorRunRecipeSchema.parse({
    kind: "operator-run",
    wrapped: application(),
    stages: ["apply-safety", "sync"],
  });
  const withChannel = CompoundRecipeSchema.parse({
    kind: "compound",
    subRecipes: [
      { instance: "application:arcade", definition: application() },
      {
        instance: "channel:npm/@shepherdjerred/webring",
        pointOfNoReturn: true,
        definition: channel,
      },
    ],
  });
  expect(targetWithoutRemoval(kubernetes)).toBeNull();
  expect(targetWithoutRemoval(wrappedApplication)).toBeNull();
  expect(targetWithoutRemoval(site)).toBe("static-site");
  expect(targetWithoutRemoval(tofu("github"))).toBe("tofu");
  expect(targetWithoutRemoval(tofu("argocd"))).toBe("operator-run tofu");
  expect(targetWithoutRemoval(channel)).toBe("channel");
  expect(targetWithoutRemoval(host)).toBe("operator-run host");
  // A compound is removable only when every sub-recipe is.
  expect(targetWithoutRemoval(withChannel)).toBe("channel");
});
