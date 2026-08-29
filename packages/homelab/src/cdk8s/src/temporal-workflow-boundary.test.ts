import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  synthesizeTemporalResources,
} from "./temporal-test-resources.ts";

function resources() {
  return synthesizeTemporalResources(".test-synth-temporal-workflow-boundary");
}

describe("central Temporal Workflow boundary", () => {
  test("runs a credentialless Workflow-only role", () => {
    const deployment = findTemporalResource(
      resources(),
      "Deployment",
      "temporal-temporal-workflows",
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
                  }),
                ),
                volumeMounts: z.array(
                  z.object({ mountPath: z.string(), name: z.string() }),
                ),
              }),
            ),
            volumes: z.array(
              z.object({
                emptyDir: z.object({}).loose().optional(),
                secret: z.unknown().optional(),
              }),
            ),
          }),
        }),
      })
      .parse(deployment.spec).template;
    const container = pod.spec.containers[0];
    if (container === undefined) {
      throw new Error("Temporal Workflow container is missing");
    }

    expect(pod.metadata.labels).toMatchObject({
      app: "temporal-worker",
      component: "central-workflows",
    });
    expect(container.env).toContainEqual({
      name: "TEMPORAL_WORKER_ROLE",
      value: "workflows",
    });
    expect(container.env.map((variable) => variable.name).sort()).toEqual([
      "ENVIRONMENT",
      "OTLP_ENDPOINT",
      "TELEMETRY_ENABLED",
      "TELEMETRY_SERVICE_NAME",
      "TEMPORAL_ADDRESS",
      "TEMPORAL_METRICS_ADDRESS",
      "TEMPORAL_WORKER_ROLE",
      "TZ",
    ]);
    expect(container.volumeMounts).toEqual([
      { mountPath: "/tmp", name: "central-workflows-tmp" },
    ]);
    expect(pod.spec.volumes).toHaveLength(1);
    expect(pod.spec.volumes[0]?.emptyDir).toBeDefined();
    expect(pod.spec.volumes[0]?.secret).toBeUndefined();
    expect(JSON.stringify(deployment.spec)).not.toContain("secretKeyRef");
  });

  test("allows only metrics ingress and required control-plane egress", () => {
    const policy = findTemporalResource(
      resources(),
      "NetworkPolicy",
      "temporal-central-workflows-netpol",
    );
    const spec = z
      .object({
        podSelector: z.object({
          matchLabels: z.record(z.string(), z.string()),
        }),
        ingress: z.array(z.unknown()),
        egress: z.array(
          z.object({
            to: z
              .array(
                z.object({
                  namespaceSelector: z
                    .object({
                      matchLabels: z.record(z.string(), z.string()).optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
            ports: z.array(
              z.object({ port: z.number(), protocol: z.string() }),
            ),
          }),
        ),
      })
      .parse(policy.spec);
    const ports = spec.egress
      .flatMap((rule) =>
        rule.ports.map((port) => `${port.protocol}:${String(port.port)}`),
      )
      .sort();

    expect(spec.podSelector.matchLabels).toEqual({
      component: "central-workflows",
    });
    expect(spec.ingress).toHaveLength(1);
    expect(ports).toEqual(["TCP:4318", "TCP:53", "TCP:7233", "UDP:53"]);
    expect(ports).not.toContain("TCP:443");
    const otlpRule = spec.egress.find((rule) =>
      rule.ports.some((port) => port.port === 4318),
    );
    expect(otlpRule?.to).toEqual([
      {
        namespaceSelector: {
          matchLabels: { "kubernetes.io/metadata.name": "tempo" },
        },
      },
    ]);
  });
});
