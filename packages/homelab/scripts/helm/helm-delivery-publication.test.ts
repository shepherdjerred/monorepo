import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import type { ArtifactVersion } from "@shepherdjerred/delivery/contract";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { publicationOwners } from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";
import {
  ChartPublicationSchema,
  type ChartPublication,
} from "@shepherdjerred/ops-model/chart-publication.ts";
import { workerPoolTemplate } from "#cdk8s/scripts/delivery/worker-pool-template.ts";
import {
  planningBases,
  retainCurrentProducerArchives,
  retainDeliveryChartBases,
  validateChartProducerVersion,
  chartValidationValues,
  bindChartImageDependencies,
  stagedChartFingerprint,
  type ChartPlanningBase,
  type ChartPlanningClient,
} from "./helm-delivery-publication.ts";
import {
  fingerprintChart,
  planCharts,
  type ChartInput,
} from "./helm-release-core.ts";
import { runCommand, stageChart } from "./helm-push.ts";

const parameter = (field: string, name: string) =>
  `{{ required \`Delivery requires image:${name}\` (get (get (.Values.delivery | default dict) "${field}" | default dict) "${name}") }}`;

const version = "2.0.0-1000042";
const digest = `sha256:${"a".repeat(64)}`;

test("the real synth child receives the parent's exact chart revision inventory", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "helm-child-inventory-"));
  const output = path.join(directory, "source.json");
  const key = "HOMELAB_CHART_REVISIONS_JSON";
  const previous = Bun.env[key];
  const previousVault = Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
  const code = `
    import { App, Chart } from "cdk8s";
    import { createFliptApp } from "./src/resources/argo-applications/apps/flipt.ts";
    import { applyApplicationReleasePolicy } from "./src/application-release-policy.ts";
    const app = new App();
    const chart = new Chart(app, "apps");
    createFliptApp(chart);
    applyApplicationReleasePolicy(app);
    await Bun.write(${JSON.stringify(output)}, JSON.stringify({
      ...chart.toJson()[0].spec.source,
      vaultCredentialPresent: Bun.env.OP_SERVICE_ACCOUNT_TOKEN !== undefined,
    }));
  `;
  try {
    Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = "test-only-vault";
    Reflect.deleteProperty(Bun.env, key);
    await runCommand([process.execPath, "-e", code], {
      cwd: new URL("../../src/cdk8s/", import.meta.url).pathname,
    });
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      targetRevision: "~2.0.0-0",
      vaultCredentialPresent: false,
    });
    Bun.env[key] = JSON.stringify({ flipt: version });
    await runCommand([process.execPath, "-e", code], {
      cwd: new URL("../../src/cdk8s/", import.meta.url).pathname,
    });
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      targetRevision: version,
      vaultCredentialPresent: false,
    });
  } finally {
    if (previous === undefined) Reflect.deleteProperty(Bun.env, key);
    else Bun.env[key] = previous;
    if (previousVault === undefined) delete Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
    else Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = previousVault;
    await rm(directory, { recursive: true, force: true });
  }
});

test("producer validation supplies required selections outside packaged chart defaults", () => {
  for (const name of ["storm-forum", "storm-forum-beta"])
    expect(chartValidationValues(name)).toMatchObject({
      delivery: {
        bundleSha256: "f".repeat(64),
        previousBundleSha256: "e".repeat(64),
      },
    });
  expect(chartValidationValues("not-a-chart")).toBeUndefined();
  for (const name of ["arcade", "delivery"])
    expect(chartValidationValues(name)).toMatchObject({
      delivery: {
        image: `docker.io/shepherdjerred/${name}@sha256:${"f".repeat(64)}`,
      },
    });
  for (const name of ["temporal", "scout-beta", "scout-prod"])
    expect(chartValidationValues(name)).toMatchObject({
      delivery: {
        workerPool: expect.stringContaining(
          '"schema":"delivery-worker-pool/v1"',
        ),
      },
    });
});

test("publication freezes only exact root dependencies and preserves required PG selections and YAML 1.1 strings", () => {
  const input = JSON.stringify({
    spec: {
      image: parameter("dependencies", "caddy-s3proxy"),
      runtime: parameter("images", "temporal-worker"),
      parameters: { dedup: "off", shared: "yes" },
    },
  });
  const image = `docker.io/shepherdjerred/caddy-s3proxy@${digest}`;
  const rendered = bindChartImageDependencies(input, {
    "shepherdjerred/caddy-s3proxy": digest,
  });
  expect(Bun.YAML.parse(rendered)).toEqual({
    spec: {
      image,
      runtime: parameter("images", "temporal-worker"),
      parameters: { dedup: "off", shared: "yes" },
    },
  });
  expect(() => bindChartImageDependencies(input, {})).toThrow(
    "original published image:caddy-s3proxy",
  );
  expect(() =>
    bindChartImageDependencies(input, {
      "shepherdjerred/caddy-s3proxy": "latest",
    }),
  ).toThrow("original published image");
});

test("actual active API and control-plane archives lint and render without packaging validation selections", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "delivery-chart-values-"),
  );
  const cdk = new URL("../../src/cdk8s/", import.meta.url).pathname;
  const image = `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`;
  const selectedImage = `docker.io/shepherdjerred/delivery@sha256:${"b".repeat(64)}`;
  try {
    execFileSync(
      "bun",
      [
        "-e",
        `import { App } from "cdk8s";
        import { createDeliveryChart } from "./src/cdk8s-charts/platform/delivery.ts";
        import { createDeliveryControlPlaneChart } from "./src/cdk8s-charts/platform/delivery-control-plane.ts";
        import { applyOrdinaryDeliveryImageBindings } from "./src/ordinary-delivery-image-bindings.ts";
        const app = new App({outdir: process.argv[1]});
        const activation = {image: process.argv[2], serviceItemId: "validation-service", executorItemId: "validation-executor", argocdItemId: "validation-argo", platformRegistryItemId: "validation-registry", platformArgocdItemId: "validation-platform"};
        createDeliveryChart(app, activation);
        createDeliveryControlPlaneChart(app, activation);
        applyOrdinaryDeliveryImageBindings(app);
        app.synth();`,
        directory,
        image,
      ],
      { cwd: cdk, timeout: 30_000 },
    );
    for (const name of ["delivery", "delivery-control-plane"]) {
      const chartDirectory = path.join(cdk, "helm", name);
      const manifestPath = path.join(directory, `${name}.k8s.yaml`);
      const values = await readFile(path.join(chartDirectory, "values.yaml"));
      const stagingDirectory = path.join(directory, "staged", name);
      const archive = await stageChart(
        {
          name,
          chartDirectory,
          manifestPath,
          fingerprint: "native-validation",
        },
        "2.0.0-1",
        stagingDirectory,
      );
      // The planner compares discoverChartInputs' key; the published
      // fingerprint must be that same key or retention never matches.
      expect(await stagedChartFingerprint(name, stagingDirectory)).toBe(
        await fingerprintChart(
          chartDirectory,
          manifestPath,
          workerPoolTemplate(await readFile(manifestPath, "utf8"), name),
        ),
      );
      expect(
        execFileSync("tar", ["-xOf", archive, `${name}/values.yaml`]),
      ).toEqual(values);
      expect(
        execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }),
      ).not.toContain("validation.json");
      const selected =
        name === "delivery"
          ? "delivery.image"
          : "delivery.images.delivery-control-plane";
      const rendered = execFileSync(
        "helm",
        [
          "template",
          "selected-image",
          archive,
          "--set-string",
          `${selected}=${selectedImage}`,
        ],
        { encoding: "utf8", timeout: 30_000 },
      );
      expect(rendered.split(selectedImage)).toHaveLength(
        name === "delivery" ? 3 : 4,
      );
      expect(await readFile(path.join(chartDirectory, "values.yaml"))).toEqual(
        values,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const fingerprints = {
  arcade: `sha256:${"1".repeat(64)}`,
  apps: `sha256:${"2".repeat(64)}`,
  changed: `sha256:${"3".repeat(64)}`,
};
function fingerprintOf(name: string): string {
  const value = new Map(Object.entries(fingerprints)).get(name);
  if (value === undefined) throw new Error(`No fixture fingerprint ${name}`);
  return value;
}
const inputs: ChartInput[] = [
  {
    name: "arcade",
    fingerprint: fingerprints.arcade,
    chartDirectory: "/unused",
    manifestPath: "/unused",
  },
  {
    name: "apps",
    fingerprint: fingerprints.apps,
    chartDirectory: "/unused",
    manifestPath: "/unused",
  },
];
const qualifiedVersion = "2.0.0-1000030";
const older = new Map([
  ["arcade", { version: "2.0.0-1000041" }],
  ["apps", { version: "2.0.0-1000041" }],
]);

function unexpected(): never {
  throw new Error("Unexpected Delivery or ChartMuseum access");
}

function qualified(
  name: string,
  overrides: Record<string, unknown> = {},
): ArtifactVersion {
  return ArtifactVersionSchema.parse({
    id: `ci/1/30/chart/${name}`,
    buildId: `ci/1/30/${name}`,
    serviceId: new ServiceIndex().byChart(name)?.id,
    component: `chart:${name}`,
    kind: "chart",
    uri: `https://chartmuseum.sjer.red/charts/${name}-${qualifiedVersion}.tgz`,
    digest,
    version: qualifiedVersion,
    sourceRevision: "b".repeat(40),
    createdAt: "2026-10-17T10:00:00.000Z",
    contentFingerprint: fingerprintOf(name),
    ...overrides,
  });
}

function catalogClient(
  artifacts: Record<string, ArtifactVersion | (() => never)>,
): ChartPlanningClient & { readonly queries: unknown[] } {
  const queries: unknown[] = [];
  return {
    queries,
    latestRetainableArtifact: async (query) => {
      queries.push(query);
      const name = query.component.slice("chart:".length);
      const artifact = artifacts[name];
      if (artifact === undefined)
        throw new DeliveryClientError(404, "NOT_FOUND", `No ${name}`);
      return typeof artifact === "function" ? artifact() : artifact;
    },
  };
}

function receipt(): ChartPublication {
  return {
    schema: "delivery-chart-publications/v2",
    sourceRevision: "a".repeat(40),
    repositoryId: 1,
    pipelineNumber: 42,
    charts: [],
    retained: [],
  };
}

async function plan(options: Partial<Parameters<typeof planningBases>[1]>) {
  const bases = await planningBases(inputs, {
    version,
    dryRun: false,
    deliveryCatalog: true,
    inventory: older,
    archive: unexpected,
    pipelineNumber: 42,
    ...options,
  });
  return { bases, plan: planCharts(inputs, bases) };
}

test("an unchanged chart is retained against Delivery's qualified artifact instead of republished", async () => {
  const client = catalogClient({
    arcade: qualified("arcade"),
    apps: qualified("apps"),
  });
  const { bases, plan: result } = await plan({ client });
  expect(result.publishOrder).toEqual([]);
  expect(client.queries).toEqual(
    inputs.map((input) => ({
      serviceId: new ServiceIndex().byChart(input.name)?.id,
      component: `chart:${input.name}`,
      kind: "chart",
      beforePipeline: 42,
    })),
  );
  const publication = receipt();
  retainCurrentProducerArchives(publication, bases, result, version);
  retainDeliveryChartBases(publication, bases, result, version);
  expect(publication.charts).toEqual([]);
  expect(publication.retained).toEqual(
    inputs.map((input) => ({
      name: input.name,
      revision: qualifiedVersion,
      digest,
      artifactId: `ci/1/30/chart/${input.name}`,
      contentFingerprint: input.fingerprint,
    })),
  );
  expect(ChartPublicationSchema.parse(publication)).toEqual(publication);
});

function pendingChart(name: string): ArtifactVersion {
  return qualified(name, {
    id: `ci/1/41/chart/${name}`,
    buildId: `ci/1/41/${name}`,
    version: "2.0.0-1000041",
  });
}

test("back-to-back pipelines retain the previous pipeline's pending charts before they qualify", async () => {
  // Pipeline 30 qualified older content; pipeline 41 published today's bytes
  // and is still pending when pipeline 42's chart step plans its release.
  const queries: unknown[] = [];
  const client: ChartPlanningClient = {
    latestRetainableArtifact: async (query) => {
      queries.push(query);
      const name = query.component.slice("chart:".length);
      return query.beforePipeline > 41
        ? pendingChart(name)
        : qualified(name, { contentFingerprint: fingerprints.changed });
    },
  };
  const { bases, plan: result } = await plan({ client });
  expect(result.publishOrder).toEqual([]);
  const publication = receipt();
  retainDeliveryChartBases(publication, bases, result, version);
  expect(publication.retained.map((entry) => entry.artifactId)).toEqual(
    inputs.map((input) => `ci/1/41/chart/${input.name}`),
  );
  expect(publication.retained.map((entry) => entry.revision)).toEqual(
    inputs.map(() => "2.0.0-1000041"),
  );
  // Comparing against the stale qualified chart republished identical bytes.
  const stale = await plan({ client, pipelineNumber: 41 });
  expect(stale.plan.publishOrder).toEqual(["arcade", "apps"]);
  expect(queries).toHaveLength(inputs.length * 2);
});

test("changed content publishes the leaf and forces the coordinating apps chart", async () => {
  const { bases, plan: result } = await plan({
    client: catalogClient({
      arcade: qualified("arcade", { contentFingerprint: fingerprints.changed }),
      apps: qualified("apps"),
    }),
  });
  expect(result.publishOrder).toEqual(["arcade", "apps"]);
  const publication = receipt();
  retainDeliveryChartBases(publication, bases, result, version);
  expect(publication.retained).toEqual([]);
});

test("a chart without a qualified base is published once; other Delivery failures stop the release", async () => {
  const { plan: result } = await plan({
    client: catalogClient({ apps: qualified("apps") }),
  });
  expect(result.publishOrder).toEqual(["arcade", "apps"]);
  await expect(
    plan({
      client: catalogClient({
        arcade: () => {
          throw new DeliveryClientError(503, "UNAVAILABLE", "down");
        },
        apps: qualified("apps"),
      }),
    }),
  ).rejects.toMatchObject({ status: 503 });
  await expect(plan({})).rejects.toThrow("requires a Delivery client");
});

test("a qualified chart registered before content fingerprints is republished once", async () => {
  const { plan: result } = await plan({
    client: catalogClient({
      arcade: qualified("arcade", { contentFingerprint: undefined }),
      apps: qualified("apps"),
    }),
  });
  expect(result.publishOrder).toEqual(["arcade", "apps"]);
});

test("a qualified chart under another owner or component is a broken contract", async () => {
  await expect(
    plan({
      client: catalogClient({
        arcade: qualified("arcade", { serviceId: "gitops" }),
        apps: qualified("apps"),
      }),
    }),
  ).rejects.toThrow("canonical owner");
  await expect(
    plan({
      client: catalogClient({
        arcade: qualified("arcade", { version: "5.2.0" }),
        apps: qualified("apps"),
      }),
    }),
  ).rejects.toThrow("CI revision");
});

test("a retry compares against this producer's own ChartMuseum archive and records it as published", async () => {
  const archive: ChartPlanningBase = {
    version,
    fingerprint: fingerprints.arcade,
    digest,
  };
  const downloads: string[] = [];
  const client = catalogClient({ arcade: unexpected, apps: qualified("apps") });
  const { bases, plan: result } = await plan({
    client,
    inventory: new Map([
      ["arcade", { version }],
      ["apps", { version: "2.0.0-1000041" }],
    ]),
    archive: async (name) => {
      downloads.push(name);
      return archive;
    },
  });
  expect(downloads).toEqual(["arcade"]);
  expect(client.queries).toHaveLength(1);
  expect(result.publishOrder).toEqual([]);
  const publication = receipt();
  retainCurrentProducerArchives(publication, bases, result, version);
  retainDeliveryChartBases(publication, bases, result, version);
  expect(publication.charts).toEqual([
    {
      name: "arcade",
      revision: version,
      digest,
      contentFingerprint: fingerprints.arcade,
    },
  ]);
  expect(publication.retained.map((chart) => chart.name)).toEqual(["apps"]);
  expect(ChartPublicationSchema.parse(publication)).toEqual(publication);
  expect(() =>
    validateChartProducerVersion(publication, "1000042"),
  ).not.toThrow();
  expect(() => validateChartProducerVersion(publication, "1000043")).toThrow(
    "exact CI producer",
  );
});

test("a skipped chart whose base is not a qualified Delivery artifact cannot be retained", () => {
  const bases = new Map<string, ChartPlanningBase>([
    [
      "arcade",
      { version: "2.0.0-1000041", fingerprint: fingerprints.arcade, digest },
    ],
  ]);
  const result = planCharts(inputs, bases);
  expect(() =>
    retainDeliveryChartBases(receipt(), bases, result, version),
  ).toThrow("no qualified Delivery artifact");
});

test("dry runs plan every chart without any ChartMuseum or Delivery access", async () => {
  const { bases, plan: result } = await plan({
    dryRun: true,
    inventory: new Map([["arcade", { version }]]),
    client: catalogClient({ arcade: unexpected, apps: unexpected }),
  });
  expect(bases.size).toBe(0);
  expect(result.publishOrder).toEqual(["arcade", "apps"]);
});

test("without the Delivery catalog the base is ChartMuseum's newest archive", async () => {
  const { bases, plan: result } = await plan({
    deliveryCatalog: false,
    inventory: new Map([["arcade", { version: "2.0.0-1000041" }]]),
    archive: async (name) => ({
      version: "2.0.0-1000041",
      fingerprint: fingerprintOf(name),
      digest,
    }),
  });
  expect([...bases.keys()]).toEqual(["arcade"]);
  expect(result.publishOrder).toEqual(["apps"]);
});

test("after the catalog flip, bases come from the v2 owner and apps has none", async () => {
  const client = catalogClient({
    arcade: qualified("arcade"),
    apps: () => {
      throw new Error("v2 no longer registers the root chart");
    },
  });
  const { bases } = await plan({ client, owners: publicationOwners("v2") });
  expect(client.queries).toEqual([
    { serviceId: "arcade", component: "chart:arcade", kind: "chart" },
  ]);
  expect([...bases.keys()]).toEqual(["arcade"]);
});
