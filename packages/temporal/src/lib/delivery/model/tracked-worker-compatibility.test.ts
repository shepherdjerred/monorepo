import { describe, expect, it } from "vitest";
import { DeploymentDetailSchema } from "@shepherdjerred/delivery/contract";
import { artifact, buildChartTgz, detail } from "./testing.ts";
import { requireModelRecipe } from "./recipe.ts";
import {
  FEATURE_FLAGS_MODES_LABEL,
  FLAGS_CUTOVER_SOURCE_REVISION,
  TrackedWorkerCompatibilityError,
  assertTrackedWorkerCompatibility,
} from "./tracked-worker-compatibility.ts";

const mediaRecipe = {
  kind: "kubernetes-application",
  application: {
    name: "media",
    metadata: {
      labels: { "ci.sjer.red/managed-application": "true" },
      annotations: {
        "argocd.argoproj.io/sync-options": "Prune=false",
        "ci.sjer.red/application-lifecycle": "retain",
      },
      finalizers: [],
    },
    project: "workloads",
    destination: {
      server: "https://kubernetes.default.svc",
      namespace: "media",
    },
    source: {
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: "media",
    },
    syncOptions: ["ServerSideApply=true"],
    ignoreDifferences: [],
    revisionHistoryLimit: 5,
    lifecycle: "retain",
  },
  chartComponent: "chart:media",
  artifactParameters: {
    "delivery.images.media": { component: "image:media", format: "reference" },
    "delivery.images.streambot": {
      component: "image:streambot",
      format: "reference",
    },
    "delivery.dependencies.temporal-worker": {
      component: "image:temporal-worker",
      format: "reference",
    },
  },
  runner: { service: "ci", component: "image:ci-base" },
  steps: [
    { kind: "apply-safety", instance: "application:media" },
    { kind: "sync", instance: "application:media" },
  ],
  oracle: { probes: [], tests: [] },
};

function mediaTemplateYaml(
  workerMode: "flags" | "static" | "disabled",
): string {
  return [
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: media-api",
    "  namespace: media",
    "spec:",
    "  template:",
    "    spec:",
    "      containers:",
    "        - name: media-api",
    '          image: \'{{ required `Delivery requires image:media` (get (get (.Values.delivery | default dict) "images" | default dict) "media") }}\'',
    "          env:",
    "            - name: FEATURE_FLAGS_MODE",
    "              value: flags",
    "---",
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: media-files",
    "  namespace: media",
    "spec:",
    "  template:",
    "    spec:",
    "      containers:",
    "        - name: media-files",
    '          image: \'{{ required `Delivery requires image:temporal-worker` (get (get (.Values.delivery | default dict) "dependencies" | default dict) "temporal-worker") }}\'',
    "          env:",
    "            - name: FEATURE_FLAGS_MODE",
    `              value: ${workerMode}`,
    "---",
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: media-network",
    "  namespace: media",
    "spec:",
    "  template:",
    "    spec:",
    "      containers:",
    "        - name: media-network",
    '          image: \'{{ required `Delivery requires image:temporal-worker` (get (get (.Values.delivery | default dict) "dependencies" | default dict) "temporal-worker") }}\'',
    "          env:",
    "            - name: FEATURE_FLAGS_MODE",
    `              value: ${workerMode}`,
    "",
  ].join("\n");
}

function mediaDeployment(worker: { version: string; sourceRevision: string }) {
  const chart = {
    ...artifact({
      id: "ci/1/18413/chart/media",
      component: "chart:media",
      kind: "chart",
      uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/media-2.0.0-1018413.tgz",
      version: "2.0.0-1018413",
      character: "6",
    }),
    serviceId: "streambot",
    sourceRevision: FLAGS_CUTOVER_SOURCE_REVISION,
  };
  const base = detail(mediaRecipe, chart);
  const current = DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      serviceId: "streambot",
      environmentId: "streambot/prod",
    },
    versionSet: {
      ...base.versionSet,
      serviceId: "streambot",
      components: {
        "chart:media": chart,
        "image:media": {
          ...artifact({
            id: "ci/1/18413/image/media",
            component: "image:media",
            kind: "image",
            uri: "docker.io/shepherdjerred/media",
            version: "2.0.0-1018413",
            character: "b",
          }),
          serviceId: "streambot",
          sourceRevision: FLAGS_CUTOVER_SOURCE_REVISION,
        },
        "image:streambot": {
          ...artifact({
            id: "ci/1/18413/image/streambot",
            component: "image:streambot",
            kind: "image",
            uri: "docker.io/shepherdjerred/streambot",
            version: "2.0.0-1018413",
            character: "1",
          }),
          serviceId: "streambot",
          sourceRevision: FLAGS_CUTOVER_SOURCE_REVISION,
        },
        "image:temporal-worker": {
          ...artifact({
            id: "ci/1/18391/image/temporal-worker",
            component: "image:temporal-worker",
            kind: "image",
            uri: "docker.io/shepherdjerred/temporal-worker",
            version: worker.version,
            character: "4",
          }),
          serviceId: "temporal",
          sourceRevision: worker.sourceRevision,
        },
      },
    },
  });
  const recipe = requireModelRecipe(current);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("Expected kubernetes-application recipe");
  return { current, recipe };
}

describe("tracked Temporal worker compatibility (AI-833)", () => {
  it("refuses chart:media with FEATURE_FLAGS_MODE=flags when tracked worker predates #4948 (63cf013a6ae1)", async () => {
    const { current, recipe } = mediaDeployment({
      version: "2.0.0-1018391",
      sourceRevision: "63cf013a6ae11ac0e6fd544d7d5aa95945b54c61",
    });
    const tgz = buildChartTgz([
      { path: "media/Chart.yaml", content: "apiVersion: v2\nname: media\n" },
      {
        path: "media/templates/media.k8s.yaml",
        content: mediaTemplateYaml("flags"),
      },
    ]);
    await expect(
      assertTrackedWorkerCompatibility(current, recipe, tgz),
    ).rejects.toThrow(TrackedWorkerCompatibilityError);
    await expect(
      assertTrackedWorkerCompatibility(current, recipe, tgz),
    ).rejects.toThrow(
      /Deployment\/media-files, Deployment\/media-network set FEATURE_FLAGS_MODE=flags/u,
    );
  });

  it("admits chart:media with FEATURE_FLAGS_MODE=flags when tracked worker is at or after #4948", async () => {
    const tgz = buildChartTgz([
      {
        path: "media/templates/media.k8s.yaml",
        content: mediaTemplateYaml("flags"),
      },
    ]);
    for (const worker of [
      {
        version: "2.0.0-1018413",
        sourceRevision: FLAGS_CUTOVER_SOURCE_REVISION,
      },
      {
        version: "2.0.0-1018436",
        sourceRevision: "a332ca9200000000000000000000000000000000",
      },
    ]) {
      const { current, recipe } = mediaDeployment(worker);
      await expect(
        assertTrackedWorkerCompatibility(current, recipe, tgz),
      ).resolves.toBeUndefined();
    }
  });

  it("admits non-flags chart templates (static/disabled) with an older tracked worker", async () => {
    const { current, recipe } = mediaDeployment({
      version: "2.0.0-1018391",
      sourceRevision: "63cf013a6ae11ac0e6fd544d7d5aa95945b54c61",
    });
    for (const mode of ["static", "disabled"] as const) {
      const tgz = buildChartTgz([
        {
          path: "media/templates/media.k8s.yaml",
          content: mediaTemplateYaml(mode),
        },
      ]);
      await expect(
        assertTrackedWorkerCompatibility(current, recipe, tgz),
      ).resolves.toBeUndefined();
    }
  });

  it("checks the OCI capability label for non-CI worker version strings", async () => {
    const { current, recipe } = mediaDeployment({
      version: "attested-custom-1",
      sourceRevision: "9999999999999999999999999999999999999999",
    });
    const tgz = buildChartTgz([
      {
        path: "media/templates/media.k8s.yaml",
        content: mediaTemplateYaml("flags"),
      },
    ]);
    await expect(
      assertTrackedWorkerCompatibility(current, recipe, tgz, async () => ({
        [FEATURE_FLAGS_MODES_LABEL]: "static,disabled",
      })),
    ).rejects.toThrow(TrackedWorkerCompatibilityError);
    await expect(
      assertTrackedWorkerCompatibility(current, recipe, tgz, async () => ({
        [FEATURE_FLAGS_MODES_LABEL]: "flags,static,disabled",
      })),
    ).resolves.toBeUndefined();
  });
});
