import { describe, expect, test } from "vitest";
import {
  DELIVERY_ENVIRONMENT_ANNOTATION,
  REQUEST_INFO,
  RESOURCES_FINALIZER,
  helmParameters,
  renderApplication,
} from "./application-render.ts";
import { RecipeDefinitionSchema } from "./recipe-contract.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function recipe(overrides: Record<string, unknown> = {}) {
  return RecipeDefinitionSchema.parse({
    kind: "kubernetes-application",
    application: {
      name: "openebs",
      metadata: { finalizers: [RESOURCES_FINALIZER, "example/keep"] },
      project: "cluster",
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "openebs",
      },
      source: {
        repoURL: "https://openebs.github.io/openebs",
        chart: "openebs",
      },
      syncOptions: ["CreateNamespace=true"],
      lifecycle: "retain",
    },
    chartComponent: "chart:openebs",
    artifactParameters: {
      "zfs-localpv.zfsPlugin.image.tag": {
        component: "image:zfs-driver",
        format: "selected-digest",
      },
      "kubectl.image": { component: "image:kubectl", format: "reference" },
      "agent.image.tag": { component: "image:kubectl", format: "tag-digest" },
    },
    runner: { service: "ci", component: "image:ci-base" },
    steps: [
      { kind: "apply-safety", instance: "application:openebs" },
      { kind: "sync", instance: "application:openebs" },
    ],
    oracle: {},
    ...overrides,
  });
}

const artifacts = {
  "chart:openebs": {
    uri: "https://openebs.github.io/openebs/openebs-4.3.2.tgz",
    version: "4.3.2",
    digest: digest("c"),
  },
  "image:zfs-driver": {
    uri: "docker.io/shepherdjerred/zfs-driver",
    version: "2.8.0-1",
    digest: digest("a"),
  },
  "image:kubectl": {
    uri: "docker.io/bitnami/kubectl",
    version: "1.33.1",
    digest: digest("b"),
  },
};

/** The cloudflare-operator source archive at one version. */
function archive(version: string) {
  return {
    "archive:cloudflare-operator": {
      uri: `s3://delivery-artifacts/sources/adyanth/cloudflare-operator/${"e".repeat(64)}.tar.gz`,
      version,
      digest: digest("e"),
    },
  };
}

describe("renderApplication (T2)", () => {
  test("renders the recipe body, values object, parameters in their formats and ownership", () => {
    const application = renderApplication({
      recipe: recipe(),
      environmentId: "openebs/prod",
      configuration: {
        "helm.valuesObject": '{"engines":{"local":{"lvm":{"enabled":false}}}}',
        "zfs-localpv.zfsNode.encrKeysDir": "/var",
      },
      artifacts,
    });
    expect(application).toEqual({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: {
        name: "openebs",
        namespace: "argocd",
        labels: {},
        annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: "openebs/prod" },
        finalizers: ["example/keep"],
      },
      spec: {
        project: "cluster",
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: "openebs",
        },
        source: {
          repoURL: "https://openebs.github.io/openebs",
          chart: "openebs",
          targetRevision: "4.3.2",
          helm: {
            valuesObject: { engines: { local: { lvm: { enabled: false } } } },
            parameters: [
              {
                name: "agent.image.tag",
                value: `1.33.1@${digest("b")}`,
                forceString: true,
              },
              {
                name: "kubectl.image",
                value: `docker.io/bitnami/kubectl@${digest("b")}`,
                forceString: true,
              },
              {
                name: "zfs-localpv.zfsNode.encrKeysDir",
                value: "/var",
                forceString: true,
              },
              {
                name: "zfs-localpv.zfsPlugin.image.tag",
                value: `selected@${digest("a")}`,
                forceString: true,
              },
            ],
          },
        },
        syncPolicy: {
          automated: { enabled: false },
          syncOptions: ["CreateNamespace=true"],
        },
        ignoreDifferences: [],
      },
    });
  });

  test("a cascade lifecycle carries the resources finalizer and a cold start its initial sync", () => {
    const base = recipe();
    if (base.kind !== "kubernetes-application") throw new Error("kind");
    const cascade = recipe({
      application: { ...base.application, lifecycle: "cascade" },
    });
    const application = renderApplication({
      recipe: cascade,
      environmentId: "openebs/prod",
      configuration: {},
      artifacts,
      initialSync: { requestId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(application.metadata.finalizers).toEqual([
      "example/keep",
      RESOURCES_FINALIZER,
    ]);
    expect(application.operation).toEqual({
      initiatedBy: { username: "delivery-cold-start" },
      info: [
        { name: REQUEST_INFO, value: "11111111-1111-4111-8111-111111111111" },
      ],
      sync: { revision: "4.3.2" },
    });
  });

  test("refuses a configuration that overrides an artifact binding or a missing artifact", () => {
    expect(() =>
      renderApplication({
        recipe: recipe(),
        environmentId: "openebs/prod",
        configuration: { "kubectl.image": "docker.io/bitnami/kubectl:latest" },
        artifacts,
      }),
    ).toThrow(/Configuration sets kubectl.image/u);
    expect(() =>
      renderApplication({
        recipe: recipe(),
        environmentId: "openebs/prod",
        configuration: {},
        artifacts: { "chart:openebs": artifacts["chart:openebs"] },
      }),
    ).toThrow(/no artifact for image:/u);
  });

  test("a Git source syncs exactly the commit its archive component acquired", () => {
    const commit = "6f2804871a3cc86cef72bc7f4ace0dd0a2aabf3f";
    const git = recipe({
      application: {
        name: "cloudflare-operator",
        project: "cloudflare-operator",
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: "cloudflare-operator-system",
        },
        source: {
          repoURL: "https://github.com/adyanth/cloudflare-operator.git",
          path: "config/default",
        },
        lifecycle: "retain",
      },
      chartComponent: "archive:cloudflare-operator",
      artifactParameters: {},
      steps: [
        { kind: "apply-safety", instance: "application:cloudflare-operator" },
        { kind: "sync", instance: "application:cloudflare-operator" },
      ],
    });
    const rendered = renderApplication({
      recipe: git,
      environmentId: "cloudflare-operator/prod",
      configuration: {},
      artifacts: archive(commit),
    });
    expect(rendered.spec.source).toEqual({
      repoURL: "https://github.com/adyanth/cloudflare-operator.git",
      path: "config/default",
      targetRevision: commit,
    });
    expect(() =>
      renderApplication({
        recipe: git,
        environmentId: "cloudflare-operator/prod",
        configuration: {},
        artifacts: archive("v0.13.1"),
      }),
    ).toThrow(/syncs an exact commit/u);
  });

  test("forces every parameter to a literal string", () => {
    expect(
      helmParameters({ b: '{"a":1,"b":[2]}', a: String.raw`x\y` }),
    ).toEqual([
      { name: "a", value: String.raw`x\\y`, forceString: true },
      { name: "b", value: String.raw`\{"a":1\,"b":[2]\}`, forceString: true },
    ]);
  });
});
