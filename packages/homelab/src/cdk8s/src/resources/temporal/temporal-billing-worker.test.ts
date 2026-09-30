import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  findTemporalWorkerContainer,
  synthesizeTemporalResources,
} from "@shepherdjerred/homelab/cdk8s/src/temporal-test-resources.ts";

function resources() {
  return synthesizeTemporalResources(".test-synth-temporal-billing-worker");
}

describe("Temporal LLM billing boundary", () => {
  test("projects the dedicated admin credential only into the billing worker", () => {
    const synthesized = resources();
    const { pod, container } = findTemporalWorkerContainer(
      synthesized,
      "temporal-temporal-billing-worker",
    );
    expect(pod.metadata.labels["component"]).toBe("billing-worker");
    expect(container.env.map((entry) => entry.name).sort()).toEqual([
      "ANTHROPIC_ADMIN_API_KEY",
      "ENVIRONMENT",
      "FEATURE_FLAGS_MODE",
      "OPENAI_ADMIN_KEY",
      "OTLP_ENDPOINT",
      "TELEMETRY_ENABLED",
      "TELEMETRY_SERVICE_NAME",
      "TEMPORAL_ADDRESS",
      "TEMPORAL_METRICS_ADDRESS",
      "TEMPORAL_NAMESPACE",
      "TEMPORAL_WORKER_ROLE",
      "TZ",
    ]);
    expect(container.env).toContainEqual({
      name: "OPENAI_ADMIN_KEY",
      valueFrom: {
        secretKeyRef: {
          key: "OPENAI_ADMIN_KEY",
          name: "temporal-openai-usage-monitor",
        },
      },
    });
    expect(
      JSON.stringify(
        synthesized.filter(
          (resource) =>
            resource.metadata.name !== "temporal-temporal-billing-worker",
        ),
      ),
    ).not.toContain("OPENAI_ADMIN_KEY");

    const item = findTemporalResource(
      synthesized,
      "OnePasswordItem",
      "temporal-openai-usage-monitor",
    );
    expect(
      z.object({ itemPath: z.string() }).parse(item.spec).itemPath,
    ).toMatch(/\/items\/openai-usage-monitor$/u);
  });

  test("allows only metrics, DNS, Temporal, tracing, and HTTPS", () => {
    const synthesized = resources();
    const base = findTemporalResource(
      synthesized,
      "NetworkPolicy",
      "temporal-billing-worker-netpol",
    );
    const baseJson = JSON.stringify(base.spec);
    for (const port of [53, 443, 4318, 7233, 9464, 9465]) {
      expect(baseJson).toContain(String(port));
    }
    expect(
      synthesized.some(
        (resource) =>
          resource.metadata?.name === "temporal-billing-alertmanager-netpol",
      ),
    ).toBe(false);
    const flipt = findTemporalResource(
      synthesized,
      "NetworkPolicy",
      "temporal-workers-flipt-egress",
    );
    expect(JSON.stringify(flipt.spec)).not.toContain("billing-worker");
  });
});
