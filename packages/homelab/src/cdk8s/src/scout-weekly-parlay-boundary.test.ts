import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createScoutChart } from "./cdk8s-charts/scout.ts";
import { createTemporalChart } from "./cdk8s-charts/temporal.ts";

const ResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
    spec: z.unknown().optional(),
  })
  .loose();

function resourcesFor(app: App): z.infer<typeof ResourceSchema>[] {
  return parseAllDocuments(app.synthYaml()).flatMap((document) => {
    const resource = ResourceSchema.safeParse(document.toJSON());
    return resource.success ? [resource.data] : [];
  });
}

function findResource(
  resources: z.infer<typeof ResourceSchema>[],
  kind: string,
  name: string,
): z.infer<typeof ResourceSchema> {
  const resource = resources.find(
    (candidate) => candidate.kind === kind && candidate.metadata.name === name,
  );
  if (resource === undefined) {
    throw new Error(`Missing ${kind}/${name}`);
  }
  return resource;
}

const DeploymentSpecSchema = z.object({
  template: z.object({
    spec: z.object({
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

function scoutResources(stage: "beta" | "prod") {
  const app = new App();
  createScoutChart(app, stage);
  return resourcesFor(app);
}

describe("Scout weekly parlay deployment boundary", () => {
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

    const app = new App();
    createTemporalChart(app);
    const temporal = resourcesFor(app);
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

  test("allows only the Temporal core worker to reach Beta Scout", () => {
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
                    app: "temporal-worker",
                    component: "core-worker",
                  },
                },
              },
            ]),
            ports: [{ port: 3000, protocol: "TCP" }],
          }),
        ]),
      }),
    );

    const app = new App();
    createTemporalChart(app);
    const temporal = resourcesFor(app);
    const egressPolicy = findResource(
      temporal,
      "NetworkPolicy",
      "temporal-worker-scout-beta-netpol",
    );
    expect(egressPolicy.spec).toEqual(
      expect.objectContaining({
        podSelector: {
          matchLabels: {
            app: "temporal-worker",
            component: "core-worker",
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
