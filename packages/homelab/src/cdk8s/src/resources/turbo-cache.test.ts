import { App, Chart } from "cdk8s";
import { EnvValue } from "cdk8s-plus-31";
import { describe, expect, test } from "vitest";
import { createTurboCacheDeployment } from "./turbo-cache.ts";

describe("Turbo cache signature transport", () => {
  test("preserves client signatures without mounting a client signing key", () => {
    const chart = new Chart(new App(), "turbo-cache", {
      namespace: "turbo-cache",
    });
    const { deployment } = createTurboCacheDeployment(chart);
    const container = deployment.containers[0];
    if (container === undefined)
      throw new Error("Missing Turbo cache container");
    const variables = container.env.variables;
    expect(variables["TURBO_REMOTE_CACHE_SIGNATURE_KEY"]).toEqual(
      EnvValue.fromValue("preserve-client-signatures"),
    );
    expect(variables["TURBO_TOKEN"]?.valueFrom).toMatchObject({
      secretKeyRef: { name: "turbo-cache-secrets", key: "TURBO_TOKEN" },
    });
    expect(container.env.sources).toHaveLength(0);
    expect(() => chart.toJson()).not.toThrow();
  });
});
