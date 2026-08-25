import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findResource,
  scoutResources,
  temporalResources,
} from "./scout-test-resources.ts";

const DeploymentSpecSchema = z.object({
  template: z.object({
    spec: z.object({
      terminationGracePeriodSeconds: z.number().optional(),
      containers: z.array(
        z.object({
          env: z.array(
            z
              .object({
                name: z.string(),
                value: z.string().optional(),
                valueFrom: z.unknown().optional(),
              })
              .loose(),
          ),
        }),
      ),
    }),
  }),
});

describe("Scout weekly parlay deployment boundary", () => {
  test.each(["beta", "prod"] as const)(
    "%s Scout has exact Temporal gRPC access and drain budget",
    (stage) => {
      const scout = scoutResources(stage);
      const deployment = DeploymentSpecSchema.parse(
        findResource(scout, "Deployment", `scout-${stage}-scout-backend`).spec,
      );
      expect(deployment.template.spec.terminationGracePeriodSeconds).toBe(45);
      expect(deployment.template.spec.containers[0]?.env).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "TEMPORAL_ADDRESS",
            value:
              "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
          }),
          expect.objectContaining({
            name: "TEMPORAL_NAMESPACE",
            value: "default",
          }),
        ]),
      );
      expect(
        findResource(scout, "NetworkPolicy", "scout-egress-netpol").spec,
      ).toEqual(
        expect.objectContaining({
          egress: expect.arrayContaining([
            {
              to: [
                {
                  namespaceSelector: {
                    matchLabels: {
                      "kubernetes.io/metadata.name": "temporal",
                    },
                  },
                  podSelector: {
                    matchLabels: { app: "temporal-server" },
                  },
                },
              ],
              ports: [{ port: 7233, protocol: "TCP" }],
            },
          ]),
        }),
      );
    },
  );

  test("Temporal admits only the two Scout backend identities on gRPC", () => {
    const policy = findResource(
      temporalResources(),
      "NetworkPolicy",
      "temporal-server-netpol",
    );
    expect(policy.spec).toEqual(
      expect.objectContaining({
        ingress: expect.arrayContaining([
          {
            from: ["scout-beta", "scout-prod"].map((namespace) => ({
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": namespace,
                },
              },
              podSelector: { matchLabels: { app: "scout-backend" } },
            })),
            ports: [{ port: 7233, protocol: "TCP" }],
          },
        ]),
      }),
    );
  });
  test("shares one 1Password credential with Beta Scout and the core worker", () => {
    const beta = scoutResources("beta");
    const betaDeployment = DeploymentSpecSchema.parse(
      findResource(beta, "Deployment", "scout-beta-scout-backend").spec,
    );
    expect(betaDeployment.template.spec.containers[0]?.env).toContainEqual(
      expect.objectContaining({
        name: "WEEKLY_PARLAY_CONTROL_TOKEN",
        valueFrom: expect.any(Object),
      }),
    );

    const temporal = temporalResources();
    const temporalDeployment = DeploymentSpecSchema.parse(
      findResource(temporal, "Deployment", "temporal-temporal-worker").spec,
    );
    expect(temporalDeployment.template.spec.containers[0]?.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "SCOUT_WEEKLY_PARLAY_CONTROL_URL",
          value:
            "http://scout-service-beta.scout-beta.svc.cluster.local:3000/api/internal/weekly-parlays/actions",
        }),
        expect.objectContaining({
          name: "SCOUT_WEEKLY_PARLAY_CONTROL_TOKEN",
          valueFrom: expect.any(Object),
        }),
      ]),
    );

    for (const deploymentName of [
      "temporal-temporal-glitter-corpus-worker",
      "temporal-temporal-glitter-context-worker",
    ]) {
      const glitterDeployment = DeploymentSpecSchema.parse(
        findResource(temporal, "Deployment", deploymentName).spec,
      );
      expect(
        glitterDeployment.template.spec.containers[0]?.env.some(
          (entry) => entry.name === "SCOUT_WEEKLY_PARLAY_CONTROL_TOKEN",
        ),
      ).toBe(false);
    }
  });

  test("keeps the private control endpoint absent from production Scout", () => {
    const prod = scoutResources("prod");
    const deployment = DeploymentSpecSchema.parse(
      findResource(prod, "Deployment", "scout-prod-scout-backend").spec,
    );
    expect(
      deployment.template.spec.containers[0]?.env.some(
        (entry) => entry.name === "WEEKLY_PARLAY_CONTROL_TOKEN",
      ),
    ).toBe(false);
    expect(
      prod.some(
        (resource) =>
          resource.kind === "OnePasswordItem" &&
          resource.metadata.name === "scout-weekly-parlay-control",
      ),
    ).toBe(false);
  });

  test("allows the Scout and legacy Temporal workers to reach Beta Scout", () => {
    const beta = scoutResources("beta");
    const policy = findResource(beta, "NetworkPolicy", "scout-ingress-netpol");
    expect(policy.spec).toEqual(
      expect.objectContaining({
        ingress: expect.arrayContaining([
          expect.objectContaining({
            from: expect.arrayContaining([
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": "temporal",
                  },
                },
                podSelector: {
                  matchLabels: {
                    component: "scout-worker",
                  },
                },
              },
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": "temporal",
                  },
                },
                podSelector: {
                  matchLabels: {
                    component: "legacy-worker",
                  },
                },
              },
            ]),
            ports: [{ port: 3000, protocol: "TCP" }],
          }),
        ]),
      }),
    );

    const temporal = temporalResources();
    const egressPolicy = findResource(
      temporal,
      "NetworkPolicy",
      "temporal-worker-scout-beta-netpol",
    );
    expect(egressPolicy.spec).toEqual(
      expect.objectContaining({
        podSelector: {
          matchLabels: {
            component: "scout-worker",
          },
        },
        egress: [
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": "scout-beta",
                  },
                },
                podSelector: { matchLabels: { app: "scout-backend" } },
              },
            ],
            ports: [{ port: 3000, protocol: "TCP" }],
          },
        ],
      }),
    );

    const legacyEgressPolicy = findResource(
      temporal,
      "NetworkPolicy",
      "temporal-legacy-worker-scout-beta-netpol",
    );
    expect(legacyEgressPolicy.spec).toEqual(
      expect.objectContaining({
        podSelector: {
          matchLabels: {
            component: "legacy-worker",
          },
        },
        egress: [
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": "scout-beta",
                  },
                },
                podSelector: { matchLabels: { app: "scout-backend" } },
              },
            ],
            ports: [{ port: 3000, protocol: "TCP" }],
          },
        ],
      }),
    );
  });
});
