import { expect, test } from "vitest";
import type { ChartPublication } from "@shepherdjerred/ops-model/chart-publication.ts";
import {
  deliveryPlanningBase,
  retainCurrentProducerArchives,
  validateChartProducerVersion,
  chartValidationValues,
} from "./helm-delivery-publication.ts";
import { planCharts } from "./helm-release-core.ts";

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
  expect(chartValidationValues("delivery")).toBeUndefined();
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
