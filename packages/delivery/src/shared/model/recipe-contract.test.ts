import { describe, expect, test } from "vitest";
import { PipelineDefinitionSchema } from "#shared/pipeline-contract.ts";
import { recipeFromPipeline } from "./recipe-adapter.ts";
import {
  ChannelRecipeSchema,
  CompoundRecipeSchema,
  KubernetesApplicationRecipeSchema,
  OperatorRunRecipeSchema,
  RecipeDefinitionSchema,
  recipeComponents,
  recipeInstances,
  recipeRunners,
  TofuRecipeSchema,
} from "./recipe-contract.ts";

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

function application(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "kubernetes-application",
    application: {
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
    },
    chartComponent: "chart:arcade",
    artifactParameters: { "delivery.image": "image:arcade" },
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
  expect(recipe.application.source.chart, file).toBe(pipeline.chartName);
  expect(recipe.chartComponent, file).toBe(pipeline.chartComponent);
  expect(recipe.artifactParameters, file).toEqual(pipeline.artifactParameters);
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
    expect(definitions.length).toBeGreaterThan(20);
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
      /must name the Application's source chart/u,
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
