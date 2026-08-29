import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  synthesizeTemporalResources,
} from "./temporal-test-resources.ts";

function resources() {
  return synthesizeTemporalResources(".test-synth-temporal-freshrss");
}

describe("Temporal FreshRSS integration", () => {
  test("projects the canonical manifest and existing password item", () => {
    const synthesized = resources();
    const manifest = findTemporalResource(
      synthesized,
      "ConfigMap",
      "temporal-freshrss-manifest",
    );
    expect(manifest.data?.["desired.json"]).toContain(
      '"category": "Repo Stack"',
    );

    const credential = findTemporalResource(
      synthesized,
      "OnePasswordItem",
      "temporal-freshrss-sync",
    );
    const spec = z.object({ itemPath: z.string() }).parse(credential.spec);
    expect(spec.itemPath).toMatch(/\/items\/freshrss-sync$/u);
  });

  test("configures the repo worker and scoped FreshRSS network access", () => {
    const synthesized = resources();
    const deployment = findTemporalResource(
      synthesized,
      "Deployment",
      "temporal-temporal-repo-worker",
    );
    const deploymentSpec = z
      .object({
        template: z.object({
          metadata: z.object({ labels: z.record(z.string(), z.string()) }),
          spec: z.object({
            containers: z.array(
              z
                .object({
                  env: z.array(
                    z.object({
                      name: z.string(),
                      value: z.string().optional(),
                    }),
                  ),
                  volumeMounts: z.array(
                    z.object({ mountPath: z.string() }).loose(),
                  ),
                })
                .loose(),
            ),
            volumes: z.array(
              z
                .object({
                  configMap: z.object({ name: z.string() }).loose().optional(),
                  secret: z
                    .object({ secretName: z.string() })
                    .loose()
                    .optional(),
                })
                .loose(),
            ),
          }),
        }),
      })
      .parse(deployment.spec);
    const container = deploymentSpec.template.spec.containers[0];
    if (container === undefined) {
      throw new Error("Temporal repo worker container is missing");
    }
    expect(deploymentSpec.template.metadata.labels).toMatchObject({
      app: "temporal-worker",
      component: "repo-worker",
    });
    expect(container.env).toContainEqual({
      name: "FRESHRSS_API_PASSWORD_FILE",
      value: "/run/secrets/freshrss/password",
    });
    expect(container.env).toContainEqual({
      name: "FLIPT_URL",
      value: "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
    });
    expect(container.volumeMounts).toContainEqual(
      expect.objectContaining({
        mountPath: "/etc/freshrss",
        readOnly: true,
      }),
    );
    expect(container.volumeMounts).toContainEqual(
      expect.objectContaining({
        mountPath: "/run/secrets/freshrss",
        readOnly: true,
      }),
    );
    expect(deploymentSpec.template.spec.volumes).toContainEqual(
      expect.objectContaining({
        configMap: expect.objectContaining({
          name: "temporal-freshrss-manifest",
        }),
      }),
    );
    expect(deploymentSpec.template.spec.volumes).toContainEqual(
      expect.objectContaining({
        secret: expect.objectContaining({
          secretName: "temporal-freshrss-sync",
        }),
      }),
    );

    const policy = findTemporalResource(
      synthesized,
      "NetworkPolicy",
      "temporal-worker-freshrss-netpol",
    );
    const policySpec = z
      .object({
        podSelector: z.object({
          matchLabels: z.record(z.string(), z.string()),
        }),
        egress: z.array(z.unknown()),
      })
      .parse(policy.spec);
    expect(policySpec.podSelector.matchLabels).toEqual({
      component: "repo-worker",
    });
    expect(policySpec.egress).toContainEqual({
      ports: [{ port: 80, protocol: "TCP" }],
      to: [
        {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "freshrss" },
          },
          podSelector: { matchLabels: { app: "freshrss" } },
        },
      ],
    });

    const alertmanagerPolicy = findTemporalResource(
      synthesized,
      "NetworkPolicy",
      "temporal-repo-alertmanager-netpol",
    );
    const alertmanagerPolicySpec = z
      .object({
        podSelector: z.object({
          matchLabels: z.record(z.string(), z.string()),
        }),
        egress: z.array(z.unknown()),
      })
      .parse(alertmanagerPolicy.spec);
    expect(alertmanagerPolicySpec.podSelector.matchLabels).toEqual({
      component: "repo-worker",
    });
    expect(alertmanagerPolicySpec.egress).toContainEqual({
      ports: [{ port: 9093, protocol: "TCP" }],
    });

    const fliptPolicy = findTemporalResource(
      synthesized,
      "NetworkPolicy",
      "temporal-repo-flipt-netpol",
    );
    const fliptPolicySpec = z
      .object({
        podSelector: z.object({
          matchLabels: z.record(z.string(), z.string()),
        }),
        egress: z.array(z.unknown()),
      })
      .parse(fliptPolicy.spec);
    expect(fliptPolicySpec.podSelector.matchLabels).toEqual({
      component: "repo-worker",
    });
    expect(fliptPolicySpec.egress).toContainEqual({
      ports: [{ port: 8080, protocol: "TCP" }],
      to: [
        {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "flipt" },
          },
        },
      ],
    });
  });
});
