import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  findTemporalWorkerContainer,
  synthesizeTemporalResources,
} from "@shepherdjerred/homelab/cdk8s/src/temporal-test-resources.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";

function resources() {
  return synthesizeTemporalResources(".test-synth-temporal-service-boundary");
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

  test("permits cluster S3 only for its five additional consuming roles", () => {
    const synthesized = resources();
    const components = [
      "reports-worker",
      "repo-worker",
      "scout-worker",
      "glitter-corpus-worker",
      "infra-worker",
    ];
    // The infra worker mounts its service-account token, so it is read
    // directly rather than through the token-less worker helper.
    for (const component of components.filter((c) => c !== "infra-worker")) {
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
    const infra = z
      .object({
        template: z.object({
          spec: z.object({
            containers: z.array(
              z.object({
                env: ContainerEnvSchema,
              }),
            ),
          }),
        }),
      })
      .parse(
        findTemporalResource(
          synthesized,
          "Deployment",
          "temporal-temporal-infra-worker",
        ).spec,
      );
    const infraEnv = infra.template.spec.containers[0]?.env ?? [];
    expect(
      infraEnv.find((variable) => variable.name === "RWF_ARCHIVE_S3_ENDPOINT")
        ?.value,
    ).toMatch(/:8333$/u);
    expect(
      infraEnv.find((variable) => variable.name === "RWF_ARCHIVE_S3_BUCKET")
        ?.value,
    ).toBe("the-storm-rwf-recordings");
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
