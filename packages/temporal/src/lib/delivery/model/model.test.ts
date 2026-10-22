import { describe, expect, test } from "vitest";
import { DeploymentDetailSchema } from "@shepherdjerred/delivery/contract";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "#lib/delivery/argo-client.ts";
import { frozenRunnerImage, testWorkspace } from "./oracle-inputs.ts";
import { CASCADE_FINALIZER, renderApplication } from "./application.ts";
import { applicationProgress } from "./application-proof.ts";
import {
  modelRecipe,
  modelSteps,
  requireModelRecipe,
  resumeAt,
} from "./recipe.ts";

const timestamp = "2026-10-21T00:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;

function artifact(input: {
  id: string;
  component: string;
  kind: "image" | "chart" | "archive";
  uri: string;
  version: string;
  character: string;
}) {
  return {
    id: input.id,
    component: input.component,
    kind: input.kind,
    uri: input.uri,
    digest: digest(input.character),
    version: input.version,
    serviceId: "arcade",
    buildId: "build/1",
    sourceRevision: "a".repeat(40),
    createdAt: timestamp,
  };
}

const image = artifact({
  id: "image/1",
  component: "image:arcade",
  kind: "image",
  uri: "docker.io/shepherdjerred/arcade",
  version: "1.0.1",
  character: "a",
});
const accepted = artifact({
  id: "image/accepted",
  component: "image:arcade",
  kind: "image",
  uri: "docker.io/shepherdjerred/arcade",
  version: "1.0.0",
  character: "e",
});
const runner = artifact({
  id: "ci-base/1",
  component: "image:ci-base",
  kind: "image",
  uri: "docker.io/shepherdjerred/ci-base",
  version: "1",
  character: "f",
});

function recipe(source: Record<string, unknown>, chartComponent: string) {
  return {
    kind: "kubernetes-application",
    application: {
      name: "arcade",
      project: "default",
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "arcade",
      },
      source,
      lifecycle: "cascade",
      syncPolicy: { automated: { selfHeal: true, prune: false } },
    },
    chartComponent,
    artifactParameters: chartComponent.startsWith("chart:")
      ? {
          "image.tag": "image:arcade",
          "sandbox.image": {
            component: "image:arcade",
            acceptedIn: "arcade/beta",
          },
        }
      : {},
    runner: { service: "ci", component: "image:ci-base" },
    steps: [
      { kind: "apply-safety", instance: "application:arcade" },
      { kind: "sync", instance: "application:arcade" },
    ],
    oracle: {
      probes: [{ url: "https://arcade.sjer.red/health", expectedStatus: 200 }],
      tests: [
        { suite: "e2e", resultPath: "packages/arcade/test-results/e2e.json" },
      ],
    },
  };
}

function detail(
  definition: unknown,
  sourceArtifact: ReturnType<typeof artifact>,
) {
  return DeploymentDetailSchema.parse({
    deployment: {
      id: "deployment/1",
      requestId: "request/1",
      environmentId: "arcade/prod",
      serviceId: "arcade",
      versionSetRevisionId: "version/1",
      pipelineRevisionId: "arcade/3",
      configurationId: "config/1",
      catalogRevision: "test-catalog",
      expectedGeneration: 0,
      kind: "deploy",
      status: "running",
      requestedBy: "operator",
      message: null,
      cancelRequested: false,
      recoveryRequired: false,
      createdAt: timestamp,
      startedAt: timestamp,
      finishedAt: null,
      admissionSnapshot: {
        prerequisites: [],
        runners: [
          { service: "ci", component: "image:ci-base", artifact: runner },
        ],
        references: { "sandbox.image": accepted },
      },
    },
    environment: {
      id: "arcade/prod",
      serviceId: "arcade",
      name: "prod",
      application: "arcade",
      pipelineRevisionId: "arcade/3",
      declaredConfigurationId: "config/1",
      automatic: false,
      promotionSourceEnvironmentId: null,
      role: "durable",
      lifecycle: "active",
      approvalPolicy: "none",
      acceptedDeploymentId: null,
      generation: 1,
      desiredVersionSetRevisionId: null,
      observedVersionSetRevisionId: null,
      acceptedVersionSetRevisionId: null,
      observedAt: null,
      activeDeploymentId: "deployment/1",
      createdAt: timestamp,
    },
    versionSet: {
      id: "version/1",
      serviceId: "arcade",
      revision: 1,
      baseRevisionId: null,
      lineage: "0".repeat(64),
      orderKey: "0000000001.0000000000",
      createdAt: timestamp,
      components: {
        "image:arcade": image,
        [sourceArtifact.component]: sourceArtifact,
      },
    },
    pipeline: { id: "arcade/3", createdAt: timestamp, definition },
    configuration: { id: "config/1", content: { replicas: "2" } },
    evidence: [],
    stages: [],
  });
}

const chart = artifact({
  id: "chart/1",
  component: "chart:arcade",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.0.1.tgz",
  version: "1.0.1",
  character: "b",
});
const helm = detail(
  recipe(
    { repoURL: "https://chartmuseum.tailnet-1a49.ts.net", chart: "arcade" },
    "chart:arcade",
  ),
  chart,
);

describe("model recipes (T3)", () => {
  test("only model recipes run on the step executor", () => {
    expect(modelRecipe(helm)?.kind).toBe("kubernetes-application");
    const v1 = {
      ...helm,
      pipeline: {
        ...helm.pipeline,
        definition: {
          kind: "argocd",
          application: "arcade",
          chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
          chartName: "arcade",
          chartComponent: "chart:arcade",
          parameters: {},
          artifactParameters: {},
        },
      },
    };
    expect(modelRecipe(DeploymentDetailSchema.parse(v1))).toBeNull();
  });

  test("steps keep their frozen order with oracle suites last, and resume at the first unsettled one", () => {
    const steps = modelSteps(requireModelRecipe(helm));
    expect(steps.map((step) => step.key)).toEqual([
      "step/apply-safety",
      "step/sync",
      "test/e2e",
    ]);
    expect(resumeAt(steps, [])).toBe(0);
    expect(
      resumeAt(steps, [
        { key: "step/apply-safety", status: "succeeded" },
        { key: "step/sync", status: "running" },
      ]),
    ).toBe(1);
    expect(
      resumeAt(
        steps,
        steps.map((step) => ({ key: step.key, status: "succeeded" })),
      ),
    ).toBe(3);
  });
});

describe("Application rendering (T2, A5)", () => {
  test("a Helm source binds the chart version, configuration and artifact parameters by path form", () => {
    const recipeValue = requireModelRecipe(helm);
    if (recipeValue.kind !== "kubernetes-application")
      throw new Error("Expected a Kubernetes recipe");
    const rendered = renderApplication(helm, recipeValue);
    expect(rendered.revision).toBe("1.0.1");
    expect(rendered.source).toEqual({
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: "arcade",
      targetRevision: "1.0.1",
      helm: {
        parameters: [
          {
            name: "image.tag",
            value: `1.0.1@${digest("a")}`,
            forceString: true,
          },
          { name: "replicas", value: "2", forceString: true },
          {
            name: "sandbox.image",
            value: `docker.io/shepherdjerred/arcade@${digest("e")}`,
            forceString: true,
          },
        ],
      },
    });
    expect(rendered.body.metadata).toMatchObject({
      name: "arcade",
      namespace: "argocd",
      annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: "arcade/prod" },
      finalizers: [CASCADE_FINALIZER],
    });
    expect(rendered.body.spec).toMatchObject({
      project: "default",
      syncPolicy: { automated: { enabled: false } },
    });
  });

  test("a Git source binds the archive's exact commit and takes no Helm values", () => {
    const archive = artifact({
      id: "archive/1",
      component: "archive:arcade",
      kind: "archive",
      uri: "s3://delivery-artifacts/arcade/1.tar",
      version: "c".repeat(40),
      character: "c",
    });
    const git = detail(
      recipe(
        { repoURL: "https://github.com/example/operator", path: "deploy" },
        "archive:arcade",
      ),
      archive,
    );
    const value = requireModelRecipe(git);
    if (value.kind !== "kubernetes-application")
      throw new Error("Expected a Kubernetes recipe");
    expect(renderApplication(git, value).source).toEqual({
      repoURL: "https://github.com/example/operator",
      path: "deploy",
      targetRevision: "c".repeat(40),
    });
  });

  test("the oracle runs suites in their report's workspace on the frozen runner", () => {
    expect(testWorkspace("packages/arcade/test-results/e2e.json")).toBe(
      "packages/arcade",
    );
    expect(() => testWorkspace("e2e.json")).toThrow(/outside a packages/u);
    expect(
      frozenRunnerImage(helm, { service: "ci", component: "image:ci-base" }),
    ).toBe(`docker.io/shepherdjerred/ci-base@${digest("f")}`);
  });
});

describe("Application readback proof (A2)", () => {
  const value = requireModelRecipe(helm);
  if (value.kind !== "kubernetes-application")
    throw new Error("Expected a Kubernetes recipe");
  const rendered = renderApplication(helm, value);
  const requestId = "11111111-1111-4111-8111-111111111111";
  function observed(overrides: {
    owner?: string;
    source?: unknown;
    phase?: string;
    request?: string;
    revision?: string;
    health?: string;
  }) {
    return {
      metadata: {
        name: "arcade",
        uid: "uid-1",
        annotations: {
          [DELIVERY_ENVIRONMENT_ANNOTATION]: overrides.owner ?? "arcade/prod",
        },
      },
      spec: { source: overrides.source ?? rendered.source },
      status: {
        sync: { status: "Synced", revision: overrides.revision ?? "1.0.1" },
        health: { status: overrides.health ?? "Healthy" },
        operationState: {
          phase: overrides.phase ?? "Succeeded",
          operation: {
            info: [
              {
                name: "ci.sjer.red/request-id",
                value: overrides.request ?? requestId,
              },
              {
                name: "ci.sjer.red/operation-id",
                value: "22222222-2222-4222-8222-222222222222",
              },
            ],
          },
          syncResult: { revision: overrides.revision ?? "1.0.1" },
        },
      },
    };
  }

  test("settles only on the owned request at the exact revision, Synced and Healthy", () => {
    expect(
      applicationProgress(observed({}), rendered, requestId),
    ).toMatchObject({
      settled: true,
      operationId: "22222222-2222-4222-8222-222222222222",
      revision: "1.0.1",
    });
    expect(
      applicationProgress(observed({ request: "other" }), rendered, requestId),
    ).toMatchObject({ settled: false, requested: false });
    expect(
      applicationProgress(observed({ phase: "Running" }), rendered, requestId),
    ).toMatchObject({ settled: false, requested: true });
    expect(
      applicationProgress(
        observed({ health: "Progressing" }),
        rendered,
        requestId,
      ),
    ).toMatchObject({ settled: false });
  });

  test("refuses foreign owners, other sources, failed operations and other revisions", () => {
    expect(() =>
      applicationProgress(
        observed({ owner: "other/prod" }),
        rendered,
        requestId,
      ),
    ).toThrow(/not owned/u);
    expect(() =>
      applicationProgress(
        observed({ source: { repoURL: "x" } }),
        rendered,
        requestId,
      ),
    ).toThrow(/source differs/u);
    expect(() =>
      applicationProgress(observed({ phase: "Failed" }), rendered, requestId),
    ).toThrow(/ended Failed/u);
    expect(() =>
      applicationProgress(observed({ revision: "1.0.0" }), rendered, requestId),
    ).toThrow(/synced a revision other than/u);
  });
});
