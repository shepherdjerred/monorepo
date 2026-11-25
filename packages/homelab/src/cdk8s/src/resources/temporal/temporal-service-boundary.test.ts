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

  test("permits cluster S3 only for its six additional consuming roles", () => {
    const synthesized = resources();
    const components = [
      "reports-worker",
      "repo-worker",
      "scout-worker",
      "glitter-corpus-worker",
      "glitter-context-worker",
      "infra-worker",
    ];
    // The infra worker mounts its service-account token, so it is read
    // directly rather than through the token-less worker helper.
    for (const component of components.filter((c) => c !== "infra-worker")) {
      const { container } = findTemporalWorkerContainer(
        synthesized,
        `temporal-temporal-${component}`,
      );
      const endpointKey = component.startsWith("glitter-")
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

describe("Temporal reports worker internal endpoints", () => {
  test("wires Hub ingest and mail API endpoints, secrets, and egress policy on the reports worker", () => {
    const synthesized = resources();
    const { container } = findTemporalWorkerContainer(
      synthesized,
      "temporal-temporal-reports-worker",
    );
    expect(container.env).toContainEqual({
      name: "OPS_DASHBOARD_URL",
      value:
        "http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
    });
    expect(container.env).toContainEqual({
      name: "MAIL_API_URL",
      value: "http://mail.mail.svc.cluster.local:7371",
    });
    const tokenEntry = container.env.find(
      (variable) => variable.name === "OPS_INGEST_TOKEN",
    );
    expect(tokenEntry?.valueFrom?.secretKeyRef).toMatchObject({
      key: "OPS_INGEST_TOKEN",
    });
    expect(tokenEntry?.valueFrom?.secretKeyRef.optional).toBeUndefined();
    const mailTokenEntry = container.env.find(
      (variable) => variable.name === "MAIL_API_TOKEN",
    );
    expect(mailTokenEntry?.valueFrom?.secretKeyRef).toMatchObject({
      key: "MAIL_API_TOKEN",
    });
    expect(mailTokenEntry?.valueFrom?.secretKeyRef.optional).toBeUndefined();

    const policy = findTemporalResource(
      synthesized,
      "NetworkPolicy",
      "temporal-reports-internal-netpol",
    );
    expect(policy.spec).toMatchObject({
      podSelector: { matchLabels: { component: "reports-worker" } },
      policyTypes: ["Egress"],
      egress: expect.arrayContaining([
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "mail" },
              },
              podSelector: { matchLabels: { app: "mail" } },
            },
          ],
          ports: [{ port: 7371, protocol: "TCP" }],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "alert-dashboard",
                },
              },
            },
          ],
          ports: [{ port: 7341, protocol: "TCP" }],
        },
      ]),
    });
  });
});
