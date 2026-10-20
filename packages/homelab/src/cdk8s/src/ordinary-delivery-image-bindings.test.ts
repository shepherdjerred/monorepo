import { ApiObject, App, Chart } from "cdk8s";
import { expect, test } from "vitest";
import { applyOrdinaryDeliveryImageBindings } from "./ordinary-delivery-image-bindings.ts";

function edge(chartName: string, image: string) {
  const app = new App();
  const chart = new Chart(app, chartName);
  const deployment = new ApiObject(chart, "edge", {
    apiVersion: "apps/v1",
    kind: "Deployment",
    spec: { template: { spec: { containers: [{ name: "caddy", image }] } } },
  });
  return { app, deployment };
}

test("Arcade freezes its shared Caddy dependency into chart bytes", () => {
  const { app, deployment } = edge(
    "arcade",
    "docker.io/shepherdjerred/caddy-s3proxy:delivery-recipe",
  );
  applyOrdinaryDeliveryImageBindings(app);
  expect(deployment.toJson()).toMatchObject({
    spec: {
      template: {
        spec: {
          containers: [
            {
              image:
                '{{ required `Delivery requires image:caddy-s3proxy` (get (get (.Values.delivery | default dict) "dependencies" | default dict) "caddy-s3proxy") }}',
            },
          ],
        },
      },
    },
  });
});

test("Arcade rejects an unpinned shared dependency", () => {
  const { app } = edge(
    "arcade",
    "docker.io/shepherdjerred/caddy-s3proxy:latest",
  );
  expect(() => applyOrdinaryDeliveryImageBindings(app)).toThrow(
    "must be pinned by the exact chart digest",
  );
});

test("the Arcade dependency grant does not extend to another application", () => {
  const { app } = edge(
    "birmel",
    "docker.io/shepherdjerred/caddy-s3proxy:delivery-recipe",
  );
  expect(() => applyOrdinaryDeliveryImageBindings(app)).toThrow(
    "belongs to another release owner",
  );
});
