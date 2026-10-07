import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  findTemporalWorkerContainer,
  synthesizeTemporalResources,
} from "@shepherdjerred/homelab/cdk8s/src/temporal-test-resources.ts";

function resources() {
  return synthesizeTemporalResources(".test-synth-temporal-backup-worker");
}

describe("Temporal internal service boundary", () => {
  test("keeps the home worker on TLS through its permitted HTTPS egress", () => {
    const synthesized = resources();
    const { container } = findTemporalWorkerContainer(
      synthesized,
      "temporal-temporal-home-worker",
    );
    const endpoint = container.env.find(
      (variable) => variable.name === "HA_URL",
    );
    expect(endpoint?.value).toBe("https://homeassistant.tailnet-1a49.ts.net");
    expect(endpoint?.valueFrom).toBeUndefined();
    expect(
      findTemporalResource(
        synthesized,
        "NetworkPolicy",
        "temporal-home-worker-netpol",
      ).spec,
    ).toMatchObject({
      podSelector: { matchLabels: { component: "home-worker" } },
      egress: expect.arrayContaining([
        { ports: [{ port: 443, protocol: "TCP" }] },
      ]),
    });
  });

  test("permits cluster S3 only for its four additional consuming roles", () => {
    const synthesized = resources();
    const components = [
      "reports-worker",
      "repo-worker",
      "scout-worker",
      "glitter-corpus-worker",
    ];
    for (const component of components) {
      const { container } = findTemporalWorkerContainer(
        synthesized,
        `temporal-temporal-${component}`,
      );
      const endpointKey =
        component === "glitter-corpus-worker"
          ? "GLITTER_CORPUS_S3_ENDPOINT"
          : "S3_ENDPOINT";
      expect(
        container.env.find((variable) => variable.name === endpointKey)?.value,
      ).toMatch(/:8333$/u);
    }
    const policy = findTemporalResource(
      synthesized,
      "NetworkPolicy",
      "temporal-workers-seaweedfs-netpol",
    );
    expect(policy.spec).toEqual({
      podSelector: {
        matchExpressions: [
          { key: "component", operator: "In", values: components },
        ],
      },
      policyTypes: ["Egress"],
      egress: [
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "seaweedfs" },
              },
              podSelector: {
                matchLabels: {
                  "app.kubernetes.io/name": "seaweedfs",
                  "app.kubernetes.io/instance": "seaweedfs",
                  "app.kubernetes.io/component": "s3",
                },
              },
            },
          ],
          ports: [{ port: 8333, protocol: "TCP" }],
        },
      ],
    });
  });

  test("permits the audit worker to reach only Grafana's named HTTP backend", () => {
    const policy = findTemporalResource(
      resources(),
      "NetworkPolicy",
      "temporal-infra-api-netpol",
    );
    const spec = z
      .object({
        podSelector: z.object({
          matchLabels: z.record(z.string(), z.string()),
        }),
        egress: z.array(
          z.object({
            to: z.array(z.unknown()).optional(),
            ports: z.array(
              z.object({
                port: z.union([z.string(), z.number()]),
                protocol: z.string(),
              }),
            ),
          }),
        ),
      })
      .parse(policy.spec);
    expect(spec.podSelector.matchLabels).toEqual({ component: "infra-worker" });
    expect(
      spec.egress.filter((rule) =>
        rule.ports.some((port) => port.port === "grafana"),
      ),
    ).toEqual([
      {
        to: [
          {
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
            },
            podSelector: {
              matchLabels: {
                "app.kubernetes.io/name": "grafana",
                "app.kubernetes.io/instance": "prometheus",
              },
            },
          },
        ],
        ports: [{ port: "grafana", protocol: "TCP" }],
      },
    ]);
  });
});

describe("Temporal SeaweedFS backup boundary", () => {
  test("uses one dedicated secret and no Kubernetes token", () => {
    const synthesized = resources();
    const { pod, container } = findTemporalWorkerContainer(
      synthesized,
      "temporal-temporal-backup-worker",
    );
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
