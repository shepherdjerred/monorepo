import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  DeploymentDetailSchema,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { deliveryOperationId } from "@shepherdjerred/delivery/operation-id";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "#lib/delivery/argo-client.ts";
import { forumReleaseId } from "#lib/delivery/forum.ts";
import { renderApplication } from "#lib/delivery/model/application.ts";
import {
  modelSteps,
  requireModelRecipe,
  stepRecipe,
  type KubernetesApplicationRecipe,
} from "#lib/delivery/model/recipe.ts";
import { artifact, detail, digest } from "#lib/delivery/model/testing.ts";
import { runForumBundleStep, type ForumBundleEffects } from "./forum-bundle.ts";

const KEY = "step-forum-bundle";
const chart = artifact({
  id: "chart/forum",
  component: "chart:storm-forum",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/storm-forum-1.0.1.tgz",
  version: "1.0.1",
  character: "b",
});
function forumArtifacts(character: string, xenforoVersion: string) {
  return {
    "image:storm-forum": {
      ...artifact({
        id: `image/${character}`,
        component: "image:storm-forum",
        kind: "image",
        uri: "docker.io/shepherdjerred/storm-forum",
        version: "1.0.0",
        character,
      }),
      serviceId: "storm-forum",
    },
    "archive:forum-bundle": {
      ...artifact({
        id: `bundle/${character}`,
        component: "archive:forum-bundle",
        kind: "archive",
        uri: `s3://storm-forum-releases/releases/${character.repeat(64)}.zip`,
        version: xenforoVersion,
        character,
      }),
      serviceId: "storm-forum",
      origin: {
        kind: "licensed-bundle",
        manifestDigest: digest("f"),
        xenforoVersion,
        producerSourceRevision: character.repeat(40),
      },
    },
  };
}
const forumRecipe = {
  kind: "kubernetes-application",
  application: {
    name: "storm-forum",
    project: "default",
    destination: {
      server: "https://kubernetes.default.svc",
      namespace: "storm-forum",
    },
    source: {
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: "storm-forum",
    },
    lifecycle: "retain",
  },
  chartComponent: "chart:storm-forum",
  artifactParameters: {
    "delivery.image": { component: "image:storm-forum", format: "reference" },
  },
  runner: { service: "ci", component: "image:ci-base" },
  steps: [
    { kind: "apply-safety", instance: "application:storm-forum" },
    { kind: "sync", instance: "application:storm-forum" },
    {
      kind: "forum-bundle",
      instance: "application:storm-forum",
      pointOfNoReturn: true,
      imageComponent: "image:storm-forum",
      bundleComponent: "archive:forum-bundle",
    },
  ],
  oracle: { probes: [], tests: [] },
};

/** A running storm-forum deployment of `definition`, upgrading 2.3.12 to 2.3.13. */
function forumDeployment(
  definition: unknown,
  stages: { key: string; status: "running" }[] = [],
) {
  const base = detail(definition, chart, stages);
  return DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      serviceId: "storm-forum",
      environmentId: "storm-forum/prod",
    },
    versionSet: {
      ...base.versionSet,
      serviceId: "storm-forum",
      components: {
        ...base.versionSet.components,
        "chart:storm-forum": chart,
        ...forumArtifacts("c", "2.3.13"),
      },
    },
    previousAcceptedVersionSet: {
      ...base.versionSet,
      id: "version/0",
      serviceId: "storm-forum",
      components: {
        "chart:storm-forum": chart,
        ...forumArtifacts("a", "2.3.12"),
      },
    },
    configuration: {
      id: "config/1",
      content: { "forum.xenforoVersion": "2.3.13" },
    },
    previousAcceptedConfiguration: {
      id: "config/0",
      content: { "forum.xenforoVersion": "2.3.12" },
    },
  });
}

function forumDetail(stages: { key: string; status: "running" }[] = []) {
  const current = forumDeployment(forumRecipe, stages);
  const recipe = requireModelRecipe(current);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("The forum recipe is a Kubernetes application");
  return { current, recipe };
}

const JOB = `storm-forum-release-${forumReleaseId("deployment/1")}`;
function observed(
  current: ReturnType<typeof forumDetail>["current"],
  recipe: KubernetesApplicationRecipe,
  job: { status?: string; health?: string; name?: string } | null,
) {
  const rendered = renderApplication(current, recipe);
  return {
    metadata: {
      name: "storm-forum",
      uid: "application-uid",
      annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: "storm-forum/prod" },
    },
    spec: { source: rendered.source },
    status: {
      sync: { status: "Synced", revision: "1.0.1" },
      health: { status: "Healthy" },
      operationState: {
        phase: "Succeeded",
        operation: {
          info: [
            {
              name: "ci.sjer.red/request-id",
              value: deliveryOperationId("deployment/1"),
            },
            {
              name: "ci.sjer.red/operation-id",
              value: "22222222-2222-4222-8222-222222222222",
            },
          ],
        },
        syncResult: { revision: "1.0.1" },
      },
      resources:
        job === null
          ? []
          : [
              {
                group: "batch",
                version: "v1",
                kind: "Job",
                namespace: "storm-forum",
                name: job.name ?? JOB,
                status: job.status ?? "Synced",
                health: { status: job.health ?? "Healthy" },
              },
            ],
    },
  };
}

let events: string[] = [];
let recorded: { key: string; status: string; evidence: EvidenceInput[] }[] = [];
afterEach(() => {
  events = [];
  recorded = [];
});
function effects(reads: unknown[]): ForumBundleEffects {
  return {
    read: async () => {
      events.push("read");
      await Promise.resolve();
      return reads.length > 1 ? reads.shift() : reads[0];
    },
    owned: async () => forumDetail().current,
    record: async (_current, key, status, input) => {
      events.push(`${key} ${status}`);
      recorded.push({ key, status, evidence: input.evidence ?? [] });
      await Promise.resolve();
    },
    wait: async () => {
      events.push("wait");
      await Promise.resolve();
    },
    heartbeat: vi.fn(),
  };
}

describe("forum-bundle step", () => {
  test("the rendered Application carries the release inputs bound to the frozen bundle digest", () => {
    const { current, recipe } = forumDetail();
    expect(modelSteps(recipe).map((step) => step.key)).toEqual([
      "step-apply-safety",
      "step-sync",
      KEY,
    ]);
    const source = renderApplication(current, recipe).source;
    const { parameters } = z
      .object({ helm: z.object({ parameters: z.array(z.unknown()) }) })
      .parse(source).helm;
    expect(parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "delivery.bundleSha256",
          value: "c".repeat(64),
        }),
        expect.objectContaining({
          name: "delivery.releaseId",
          value: forumReleaseId("deployment/1"),
        }),
        expect.objectContaining({
          name: "delivery.previousXenforoVersion",
          value: "2.3.12",
        }),
      ]),
    );
  });

  test("records intent, waits for the deployment's release Job, then settles with the bundle digest as evidence", async () => {
    const { current, recipe } = forumDetail();
    const evidence = await runForumBundleStep(
      current,
      recipe,
      KEY,
      effects([
        observed(current, recipe, { health: "Progressing" }),
        observed(current, recipe, {}),
      ]),
    );
    expect(events).toEqual([
      `${KEY} running`,
      "read",
      "wait",
      "read",
      `${KEY} succeeded`,
    ]);
    expect(evidence[0]?.summary).toContain(digest("c"));
    expect(evidence[0]?.summary).toContain(JOB);
  });

  test("a resumed step keeps its recorded intent and only reads back", async () => {
    const { current, recipe } = forumDetail([{ key: KEY, status: "running" }]);
    await runForumBundleStep(
      current,
      recipe,
      KEY,
      effects([observed(current, recipe, {})]),
    );
    expect(events).toEqual(["read", `${KEY} succeeded`]);
  });

  test.each([
    [{ health: "Degraded" }, /Degraded/u],
    [null, /not part of the synced Application/u],
    [
      { name: "storm-forum-release-other" },
      /not part of the synced Application/u,
    ],
  ])(
    "a failed or foreign release Job leaves the intent recorded for recovery: %o",
    async (job, message) => {
      const { current, recipe } = forumDetail();
      await expect(
        runForumBundleStep(
          current,
          recipe,
          KEY,
          effects([observed(current, recipe, job)]),
        ),
      ).rejects.toThrow(message);
      expect(recorded.map((entry) => `${entry.key} ${entry.status}`)).toEqual([
        `${KEY} running`,
      ]);
    },
  );

  test("an Application whose source no longer binds the frozen release is refused", async () => {
    const { current, recipe } = forumDetail();
    const raw = observed(current, recipe, {});
    await expect(
      runForumBundleStep(
        current,
        recipe,
        KEY,
        effects([{ ...raw, spec: { source: { chart: "storm-forum" } } }]),
      ),
    ).rejects.toThrow(/differs from the rendered exact source/u);
  });

  test("the image input is left to its artifact parameter, which must render it identically", () => {
    const { current, recipe } = forumDetail();
    const { parameters } = z
      .object({
        helm: z.object({
          parameters: z.array(z.object({ name: z.string() }).loose()),
        }),
      })
      .parse(renderApplication(current, recipe).source).helm;
    expect(
      parameters.filter((entry) => entry.name === "delivery.image"),
    ).toHaveLength(1);
    expect(() =>
      renderApplication(current, {
        ...recipe,
        artifactParameters: {
          "delivery.image": {
            component: "image:storm-forum",
            format: "tag-digest",
          },
        },
      }),
    ).toThrow(/delivery.image differs from its artifact parameter/u);
  });

  test("a rollback never re-runs a forum migration", async () => {
    const { current, recipe } = forumDetail();
    await expect(
      runForumBundleStep(
        { ...current, deployment: { ...current.deployment, kind: "rollback" } },
        recipe,
        KEY,
        effects([]),
      ),
    ).rejects.toThrow(/independent restoration procedure/u);
    expect(events).toEqual([]);
  });
});

/** The Helm parameter names a rendered source carries. */
function names(source: unknown) {
  return z
    .object({
      helm: z.object({
        parameters: z.array(z.object({ name: z.string() }).loose()),
      }),
    })
    .parse(source)
    .helm.parameters.map((entry) => entry.name);
}

describe("forum release inputs in a compound recipe", () => {
  /** The forum, then an Application that binds its own image at `delivery.image`. */
  const companion = {
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
    artifactParameters: {
      "delivery.image": { component: "image:arcade", format: "reference" },
    },
    runner: { service: "ci", component: "image:ci-base" },
    steps: [
      { kind: "apply-safety", instance: "application:arcade" },
      { kind: "sync", instance: "application:arcade" },
    ],
    oracle: { probes: [], tests: [] },
  };
  function compound() {
    const current = forumDeployment({
      kind: "compound",
      subRecipes: [
        { instance: "application:storm-forum", definition: forumRecipe },
        { instance: "application:arcade", definition: companion },
      ],
    });
    const arcadeChart = artifact({
      id: "chart/arcade",
      component: "chart:arcade",
      kind: "chart",
      uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.0.1.tgz",
      version: "1.0.1",
      character: "d",
    });
    const deployment = DeploymentDetailSchema.parse({
      ...current,
      versionSet: {
        ...current.versionSet,
        components: {
          ...current.versionSet.components,
          "chart:arcade": arcadeChart,
        },
      },
    });
    const definition = requireModelRecipe(deployment);
    const member = (key: string) => {
      const owner = stepRecipe(definition, key);
      if (owner.kind !== "kubernetes-application")
        throw new Error(`${key} is not an Application step`);
      return owner;
    };
    return {
      deployment,
      forum: member("sub1-step-sync"),
      other: member("sub2-step-sync"),
    };
  }
  test("only the forum's own Application receives its release inputs", () => {
    const { deployment, forum, other } = compound();
    expect(names(renderApplication(deployment, forum).source)).toContain(
      "delivery.releaseId",
    );
    // The other member keeps its own image binding and takes no forum input.
    expect(
      names(renderApplication(deployment, other).source).filter((name) =>
        name.startsWith("delivery."),
      ),
    ).toEqual(["delivery.image"]);
  });
});
