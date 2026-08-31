import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  synthesizeTemporalResources,
} from "./temporal-test-resources.ts";

function resources() {
  return synthesizeTemporalResources(".test-synth-temporal-backup-worker");
}

describe("Temporal SeaweedFS backup boundary", () => {
  test("uses one dedicated secret and no Kubernetes token", () => {
    const synthesized = resources();
    const deployment = findTemporalResource(
      synthesized,
      "Deployment",
      "temporal-temporal-backup-worker",
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
    if (container === undefined) {
      throw new Error("Temporal backup container is missing");
    }
    expect(pod.metadata.labels).toMatchObject({
      app: "temporal-worker",
      component: "backup-worker",
    });
    expect(container.env).toContainEqual({
      name: "TEMPORAL_WORKER_ROLE",
      value: "backup",
    });
    const backupCredentialVariables = container.env.filter((variable) =>
      variable.name.includes("ACCESS_KEY"),
    );
    expect(backupCredentialVariables).toHaveLength(4);
    expect(
      backupCredentialVariables.map(
        (variable) => variable.valueFrom?.secretKeyRef.name,
      ),
    ).toEqual([
      "temporal-seaweedfs-backup",
      "temporal-seaweedfs-backup",
      "temporal-seaweedfs-backup",
      "temporal-seaweedfs-backup",
    ]);

    const item = findTemporalResource(
      synthesized,
      "OnePasswordItem",
      "temporal-seaweedfs-backup",
    );
    expect(
      z.object({ itemPath: z.string() }).parse(item.spec).itemPath,
    ).toMatch(/\/items\/fkp3hqhl3wze3bxddhhaq3ykzq$/u);
  });

  test("limits network access to metrics, DNS, Temporal, tracing, HTTPS, and SeaweedFS", () => {
    const policy = findTemporalResource(
      resources(),
      "NetworkPolicy",
      "temporal-backup-worker-netpol",
    );
    const spec = z
      .object({
        podSelector: z.object({
          matchLabels: z.record(z.string(), z.string()),
        }),
        ingress: z.array(z.unknown()),
        egress: z.array(
          z.object({
            ports: z.array(
              z.object({ port: z.number(), protocol: z.string() }),
            ),
          }),
        ),
      })
      .parse(policy.spec);
    expect(spec.podSelector.matchLabels).toEqual({
      component: "backup-worker",
    });
    expect(spec.ingress).toHaveLength(1);
    expect(
      spec.egress
        .flatMap((rule) =>
          rule.ports.map((port) => `${port.protocol}:${String(port.port)}`),
        )
        .sort(),
    ).toEqual(["TCP:4318", "TCP:443", "TCP:53", "TCP:7233", "UDP:53"]);

    const seaweedFsPolicy = findTemporalResource(
      resources(),
      "NetworkPolicy",
      "temporal-backup-seaweedfs-netpol",
    );
    expect(JSON.stringify(seaweedFsPolicy.spec)).toContain("8333");
    expect(JSON.stringify(seaweedFsPolicy.spec)).toContain("seaweedfs");
  });
});
