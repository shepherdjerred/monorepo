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
            value: stage,
          }),
          expect.objectContaining({
            name: "TEMPORAL_SCHEDULE_RECONCILIATION",
            value: "disabled",
          }),
        ]),
      );
      // The `default` drain is retired for Scout; see scout-temporal.test.ts.
      expect(deployment.template.spec.containers[0]?.env).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "TEMPORAL_LEGACY_NAMESPACE" }),
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
});

describe("Scout Temporal ingress identity", () => {
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
});

describe("Scout weekly parlay compatibility boundary", () => {
  test("retains the callback credential only for Beta Scout and owning workers", () => {
    const beta = DeploymentSpecSchema.parse(
      findResource(
        scoutResources("beta"),
        "Deployment",
        "scout-beta-scout-backend",
      ).spec,
    );
    expect(beta.template.spec.containers[0]?.env).toContainEqual(
      expect.objectContaining({ name: "WEEKLY_PARLAY_CONTROL_TOKEN" }),
    );
    const prod = DeploymentSpecSchema.parse(
      findResource(
        scoutResources("prod"),
        "Deployment",
        "scout-prod-scout-backend",
      ).spec,
    );
    expect(
      prod.template.spec.containers[0]?.env.some(
        (entry) => entry.name === "WEEKLY_PARLAY_CONTROL_TOKEN",
      ),
    ).toBe(false);

    const temporal = temporalResources();
    const scout = DeploymentSpecSchema.parse(
      findResource(temporal, "Deployment", "temporal-temporal-scout-worker")
        .spec,
    );
    expect(scout.template.spec.containers[0]?.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "SCOUT_WEEKLY_PARLAY_CONTROL_URL" }),
        expect.objectContaining({ name: "SCOUT_WEEKLY_PARLAY_CONTROL_TOKEN" }),
      ]),
    );

    const infra = DeploymentSpecSchema.parse(
      findResource(temporal, "Deployment", "temporal-temporal-infra-worker")
        .spec,
    );
    expect(infra.template.spec.containers[0]?.env).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "SCOUT_WEEKLY_PARLAY_CONTROL_TOKEN" }),
      ]),
    );
  });

  test("retains both directions of the callback network boundary", () => {
    const betaPolicy = findResource(
      scoutResources("beta"),
      "NetworkPolicy",
      "scout-ingress-netpol",
    );
    expect(JSON.stringify(betaPolicy.spec)).toContain(
      '"kubernetes.io/metadata.name":"temporal"',
    );

    const temporal = temporalResources();
    expect(
      temporal.some(
        (resource) =>
          resource.kind === "NetworkPolicy" &&
          resource.metadata.name === "temporal-worker-scout-beta-netpol",
      ),
    ).toBe(true);
    expect(
      temporal.some(
        (resource) =>
          resource.kind === "NetworkPolicy" &&
          resource.metadata.name === "temporal-legacy-worker-scout-beta-netpol",
      ),
    ).toBe(false);
  });
});
