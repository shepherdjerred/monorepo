import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChartPublication } from "@shepherdjerred/ops-model/chart-publication.ts";
import {
  deliveryPlanningBase,
  retainCurrentProducerArchives,
  validateChartProducerVersion,
  chartValidationValues,
  bindChartImageDependencies,
} from "./helm-delivery-publication.ts";
import { planCharts } from "./helm-release-core.ts";
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
      const values = await readFile(path.join(chartDirectory, "values.yaml"));
      const archive = await stageChart(
        {
          name,
          chartDirectory,
          manifestPath: path.join(directory, `${name}.k8s.yaml`),
          fingerprint: "native-validation",
        },
        "2.0.0-1",
        path.join(directory, "staged", name),
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
const input = {
  name: "arcade",
  fingerprint: "unchanged",
  chartDirectory: "/unused",
  manifestPath: "/unused",
};

test("Delivery really republishes unchanged older archives instead of relabeling an unknown CI producer", () => {
  const previous = new Map([
    ["arcade", { version: "2.0.0-1000041", fingerprint: "unchanged", digest }],
  ]);
  expect(
    planCharts([input], deliveryPlanningBase(previous, version, false))
      .publishOrder,
  ).toEqual([]);
  expect(
    planCharts([input], deliveryPlanningBase(previous, version, true))
      .publishOrder,
  ).toEqual(["arcade"]);
});

test("only a same-producer retry reuses its original verified immutable bytes", () => {
  const previous = new Map([
    ["arcade", { version, fingerprint: "unchanged", digest }],
  ]);
  const receipt: ChartPublication = {
    schema: "delivery-chart-publications/v1",
    sourceRevision: "a".repeat(40),
    repositoryId: 1,
    pipelineNumber: 42,
    charts: [],
  };
  const plan = planCharts(
    [input],
    deliveryPlanningBase(previous, version, true),
  );
  expect(() => validateChartProducerVersion(receipt, "1000042")).not.toThrow();
  expect(() => validateChartProducerVersion(receipt, "1000043")).toThrow(
    "exact CI producer",
  );
  expect(plan.publishOrder).toEqual([]);
  retainCurrentProducerArchives(receipt, previous, plan, version);
  expect(receipt.charts).toEqual([
    { name: "arcade", revision: version, digest },
  ]);
  expect(() =>
    retainCurrentProducerArchives(
      receipt,
      new Map([["arcade", { version, fingerprint: "unchanged" }]]),
      plan,
      version,
    ),
  ).toThrow("verified original checksum");
});
