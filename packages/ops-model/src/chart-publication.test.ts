import { expect, test } from "vitest";
import { ChartPublicationSchema } from "./chart-publication.ts";

const digest = `sha256:${"a".repeat(64)}`;
const fingerprint = `sha256:${"b".repeat(64)}`;
const pushed = {
  name: "arcade",
  revision: "2.0.0-1000042",
  digest,
  contentFingerprint: fingerprint,
};
const retained = {
  name: "apps",
  revision: "2.0.0-1000030",
  digest,
  artifactId: "ci/1/30/chart/apps",
  contentFingerprint: fingerprint,
};
const receipt = {
  schema: "delivery-chart-publications/v2",
  sourceRevision: "c".repeat(40),
  pipelineNumber: 42,
  repositoryId: 1,
  charts: [pushed],
  retained: [retained],
};

test("a receipt carries pushed charts and charts retained by Delivery artifact", () => {
  expect(ChartPublicationSchema.parse(receipt)).toEqual(receipt);
  expect(
    ChartPublicationSchema.parse({ ...receipt, charts: [], retained: [] }),
  ).toMatchObject({ charts: [], retained: [] });
  expect(() =>
    ChartPublicationSchema.parse({
      ...receipt,
      schema: "delivery-chart-publications/v1",
    }),
  ).toThrow();
});

test("every chart records the content fingerprint the next planner compares against", () => {
  const { contentFingerprint: _fresh, ...pushedWithout } = pushed;
  const { contentFingerprint: _kept, ...retainedWithout } = retained;
  const { artifactId: _id, ...retainedWithoutArtifact } = retained;
  expect(() =>
    ChartPublicationSchema.parse({ ...receipt, charts: [pushedWithout] }),
  ).toThrow();
  expect(() =>
    ChartPublicationSchema.parse({ ...receipt, retained: [retainedWithout] }),
  ).toThrow();
  expect(() =>
    ChartPublicationSchema.parse({
      ...receipt,
      retained: [retainedWithoutArtifact],
    }),
  ).toThrow();
  expect(() =>
    ChartPublicationSchema.parse({
      ...receipt,
      retained: [{ ...retained, revision: "5.2.0" }],
    }),
  ).toThrow();
});

test("a chart appears once across pushed and retained entries", () => {
  expect(() =>
    ChartPublicationSchema.parse({
      ...receipt,
      retained: [retained, { ...retained, artifactId: "ci/1/31/chart/apps" }],
    }),
  ).toThrow("once per pipeline");
  expect(() =>
    ChartPublicationSchema.parse({
      ...receipt,
      retained: [{ ...retained, name: "arcade" }],
    }),
  ).toThrow("once per pipeline");
});
