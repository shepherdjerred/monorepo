import { describe, expect, test } from "vitest";
import {
  buildTracingInitializationFields,
  buildTracingResource,
} from "@shepherdjerred/temporal-observability/tracing-resource";

describe("buildTracingResource", () => {
  test("records an explicit Temporal namespace", () => {
    const resource = buildTracingResource("worker", "sha", "platform", {
      namespace: "prod",
    });

    expect(resource.attributes["temporal.namespace"]).toBe("prod");
  });

  test("omits the namespace for non-Temporal processes", () => {
    const resource = buildTracingResource("service", "sha", "platform", {});

    expect(resource.attributes).not.toHaveProperty("temporal.namespace");
  });
});

describe("buildTracingInitializationFields", () => {
  test("records an explicit Temporal namespace", () => {
    const fields = buildTracingInitializationFields({
      defaultDomain: "platform",
      otlpEndpoint: "http://tempo",
      resource: { namespace: "prod" },
      serviceName: "worker",
      serviceVersion: "sha",
    });

    expect(fields["namespace"]).toBe("prod");
  });

  test("omits the namespace for non-Temporal processes", () => {
    const fields = buildTracingInitializationFields({
      defaultDomain: "scout",
      otlpEndpoint: "http://tempo",
      resource: {},
      serviceName: "backend",
      serviceVersion: "sha",
    });

    expect(fields).not.toHaveProperty("namespace");
  });
});
