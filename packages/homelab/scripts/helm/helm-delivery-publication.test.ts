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
} from "./helm-delivery-publication.ts";
import { planCharts } from "./helm-release-core.ts";
import { stageChart } from "./helm-push.ts";

const version = "2.0.0-1000042";
const digest = `sha256:${"a".repeat(64)}`;

test("producer validation supplies required forum selections without giving other charts or packaged defaults a fake deployment", () => {
  for (const name of ["storm-forum", "storm-forum-beta"]) {
    expect(chartValidationValues(name)?.delivery.bundleSha256).toBe(
      "f".repeat(64),
    );
    expect(chartValidationValues(name)?.delivery.previousBundleSha256).toBe(
      "e".repeat(64),
    );
  }
  expect(chartValidationValues("arcade")).toBeUndefined();
  expect(chartValidationValues("delivery")).toEqual({ delivery: {} });
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
