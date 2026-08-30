import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  synthesizeTemporalResources,
} from "./temporal-test-resources.ts";
import versions from "./versions.ts";

function resources() {
  return synthesizeTemporalResources(".test-synth-temporal-workflow-boundary");
}

describe("central Temporal Workflow boundary", () => {
  test.each(["stable", "candidate"] as const)(
    "runs a credentialless %s Workflow-only role",
    (track) => {
      const deployment = findTemporalResource(
        resources(),
        "Deployment",
        `temporal-temporal-workflows-${track}`,
      );
      const pod = z
        .object({
          template: z.object({
            metadata: z.object({ labels: z.record(z.string(), z.string()) }),
            spec: z.object({
              automountServiceAccountToken: z.literal(false),
              containers: z.array(
                z.object({
                  image: z.string(),
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
        component: `central-workflows-${track}`,
        "worker-family": "central-workflows",
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
        "TEMPORAL_NAMESPACE",
        "TEMPORAL_WORKER_DEPLOYMENT_NAME",
        "TEMPORAL_WORKER_ROLE",
        "TZ",
      ]);
      expect(container.env).toContainEqual({
        name: "TEMPORAL_NAMESPACE",
        value: "default",
      });
      expect(container.env).toContainEqual({
        name: "TEMPORAL_WORKER_DEPLOYMENT_NAME",
        value: "monorepo-central-workflows",
      });
      // Read the expected pin from the catalog rather than freezing a literal:
      // each track has its own entry (candidate follows CI, stable is promoted
      // separately), and the deployment resolves the very same key, so a
      // hardcoded version made every image bump fail this test without
      // indicating anything was actually wrong.
      expect(container.image).toBe(
        `ghcr.io/shepherdjerred/temporal-worker:${versions[`shepherdjerred/temporal-worker/workflows/${track}`]}`,
      );
      expect(container.volumeMounts).toEqual([
        { mountPath: "/tmp", name: `central-workflows-${track}-tmp` },
      ]);
      expect(pod.spec.volumes).toHaveLength(1);
      expect(pod.spec.volumes[0]?.emptyDir).toBeDefined();
      expect(pod.spec.volumes[0]?.secret).toBeUndefined();
      expect(JSON.stringify(deployment.spec)).not.toContain("secretKeyRef");
    },
  );

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
      "worker-family": "central-workflows",
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

  test("admits stable and candidate workers through the Temporal server", () => {
    const serverPolicy = findTemporalResource(
      resources(),
      "NetworkPolicy",
      "temporal-server-netpol",
    );
    const serialized = JSON.stringify(serverPolicy.spec);
    expect(serialized).toContain('"worker-family":"central-workflows"');
    expect(serialized).toContain('"port":7233');
  });

  test.each(["stable", "candidate"])(
    "scrapes only the %s Workflow track",
    (track) => {
      const synthesized = resources();
      for (const serviceName of [
        `temporal-temporal-workflows-${track}-metrics-service`,
        `temporal-workflows-${track}-app-metrics`,
      ]) {
        const service = findTemporalResource(
          synthesized,
          "Service",
          serviceName,
        );
        const spec = z
          .object({ selector: z.record(z.string(), z.string()) })
          .parse(service.spec);
        expect(spec.selector).toEqual({
          component: `central-workflows-${track}`,
        });
      }
    },
  );
});
