import { App, Chart } from "cdk8s";
import { expect, test } from "vitest";
import { deliveryForumEnvironment } from "./forum-bootstrap.ts";
const activation = {
  image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
  serviceItemId: "service-item",
};
test("forum API capability projects only its exact dedicated fields and rejects incomplete registration", () => {
  const chart = new Chart(new App(), "forum-credentials");
  expect(deliveryForumEnvironment(chart, activation)).toEqual({});
  expect(() =>
    deliveryForumEnvironment(chart, {
      ...activation,
      forumReaderItemId: "6x57e27b4jb7fxgyx2nmhhcldq",
    }),
  ).toThrow("together");
  const environment = deliveryForumEnvironment(chart, {
    ...activation,
    forumReaderItemId: "6x57e27b4jb7fxgyx2nmhhcldq",
    forumObserverItemId: "es5ddbihz4qeylhjt2x2iemvzi",
  });
  expect(Object.keys(environment).sort()).toEqual([
    "DELIVERY_FORUM_OBSERVATION_TOKEN",
    "DELIVERY_FORUM_S3_ACCESS_KEY_ID",
    "DELIVERY_FORUM_S3_SECRET_ACCESS_KEY",
  ]);
  const resources = JSON.stringify(chart.toJson());
  expect(resources).toContain("6x57e27b4jb7fxgyx2nmhhcldq");
  expect(resources).toContain("es5ddbihz4qeylhjt2x2iemvzi");
  expect(resources).not.toContain('"optional":true');
});
