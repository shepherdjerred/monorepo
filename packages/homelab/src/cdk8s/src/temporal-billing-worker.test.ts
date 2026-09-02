import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  synthesizeTemporalResources,
} from "./temporal-test-resources.ts";

function resources() {
  return synthesizeTemporalResources(".test-synth-temporal-billing-worker");
}

describe("Temporal OpenAI billing boundary", () => {
  test("projects the dedicated admin credential only into the billing worker", () => {
    const synthesized = resources();
    const deployment = findTemporalResource(
      synthesized,
      "Deployment",
      "temporal-temporal-billing-worker",
    );
    const pod = z
      .object({
        template: z.object({
          metadata: z.object({ labels: z.record(z.string(), z.string()) }),
          spec: z.object({
            automountServiceAccountToken: z.literal(false),
            containers: z.array(
              z.object({
                env: z.array(
                  z.object({
                    name: z.string(),
                    value: z.string().optional(),
                    valueFrom: z
                      .object({
                        secretKeyRef: z.object({
                          key: z.string(),
                          name: z.string(),
                        }),
                      })
                      .optional(),
                  }),
                ),
              }),
            ),
          }),
        }),
      })
      .parse(deployment.spec).template;
    const container = pod.spec.containers[0];
    if (container === undefined)
      throw new Error("Billing container is missing");
    expect(pod.metadata.labels["component"]).toBe("billing-worker");
    expect(container.env.map((entry) => entry.name).sort()).toEqual([
      "ALERTMANAGER_URL",
      "ENVIRONMENT",
      "OPENAI_ADMIN_KEY",
      "OPENAI_OPENROUTER_PROJECT_ID",
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
      JSON.stringify(synthesized.filter((resource) => resource !== deployment)),
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

  test("allows only metrics, DNS, Temporal, tracing, HTTPS, and Alertmanager", () => {
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
    const alertmanager = findTemporalResource(
      synthesized,
      "NetworkPolicy",
      "temporal-billing-alertmanager-netpol",
    );
    expect(JSON.stringify(alertmanager.spec)).toContain("9093");
    const flipt = findTemporalResource(
      synthesized,
      "NetworkPolicy",
      "temporal-workers-flipt-egress",
    );
    expect(JSON.stringify(flipt.spec)).not.toContain("billing-worker");
  });
});
