import { App, Chart } from "cdk8s";
import { expect, test } from "vitest";
import { deliveryTrmnlEnvironment } from "./trmnl-bootstrap.ts";

const trmnlItemId = "p7th6tqeel7k2sm47mrrto7oca";

test("TRMNL capability requires both dedicated credentials and projects only the exact three fields", () => {
  const chart = new Chart(new App(), "trmnl-credentials");
  const activation = {
    image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
    serviceItemId: "service",
  };
  expect(deliveryTrmnlEnvironment(chart, activation)).toEqual({});
  expect(() =>
    deliveryTrmnlEnvironment(chart, {
      ...activation,
      trmnlKeyItemId: trmnlItemId,
    }),
  ).toThrow("both");
  const projected = deliveryTrmnlEnvironment(chart, {
    ...activation,
    trmnlKeyItemId: trmnlItemId,
    trmnlArchiveReaderItemId: "542onhpijguqgaukmyvbujbu74",
  });
  expect(Object.keys(projected).sort()).toEqual([
    "DELIVERY_TRMNL_S3_ACCESS_KEY_ID",
    "DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY",
    "TRMNL_API_KEY",
  ]);
  const rendered = JSON.stringify(chart.toJson());
  expect(rendered).toContain(trmnlItemId);
  expect(rendered).toContain("542onhpijguqgaukmyvbujbu74");
  expect(rendered).not.toContain('"optional":true');
});
