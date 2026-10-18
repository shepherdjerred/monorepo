import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createScoutChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import {
  allScoutTemporalResources,
  resourcesFor,
} from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";
function betaResourcesWithWorkflowCandidate() {
  const app = new App();
  createScoutChart(app, "beta");
  return resourcesFor(app);
}
function prodResourcesWithWorkflowCandidate() {
  const app = new App();
  createScoutChart(app, "prod");
  return resourcesFor(app);
}

const WorkflowDeploymentSpecSchema = z.object({
  template: z.object({
    spec: z.object({
      automountServiceAccountToken: z.boolean(),
      containers: z.array(
        z.object({
          args: z.array(z.string()),
          command: z.array(z.string()),
          image: z.string(),
          readinessProbe: z.object({
            exec: z.object({ command: z.array(z.string()) }),
          }),
          env: z.array(
            z.object({
              name: z.string(),
              value: z.string().optional(),
              valueFrom: z.unknown().optional(),
            }),
          ),
          volumeMounts: z.array(
            z.object({ mountPath: z.string(), name: z.string() }),
          ),
        }),
      ),
      volumes: z.array(z.object({ name: z.string() }).loose()),
    }),
  }),
});

describe("Scout competition Temporal boundary", () => {
  test.each(["beta", "prod"] as const)(
    "configures %s with the Temporal endpoint and egress",
    (stage) => {
      const synthesized = allScoutTemporalResources();
      const deployment = synthesized.find(
        (resource) =>
          resource.kind === "Deployment" &&
          resource.metadata.namespace === `scout-${stage}` &&
          resource.metadata.name === `scout-${stage}-scout-backend`,
      );
      const deploymentSpec = z
        .object({
          template: z.object({
            spec: z.object({
              containers: z.array(
                z.object({
                  env: z.array(
                    z.object({
                      name: z.string(),
                      value: z.string().optional(),
                    }),
                  ),
                }),
              ),
            }),
          }),
        })
        .parse(deployment?.spec);
      const env = new Map(
        deploymentSpec.template.spec.containers[0]?.env.map((entry) => [
          entry.name,
          entry.value,
        ]),
      );
      expect(env.get("TEMPORAL_ADDRESS")).toBe(
        "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
      );
      expect(env.get("TEMPORAL_NAMESPACE")).toBe(stage);
      expect(env.get("TEMPORAL_SCHEDULE_RECONCILIATION")).toBe("auto");

      const egressPolicy = synthesized.find(
        (resource) =>
          resource.kind === "NetworkPolicy" &&
          resource.metadata.namespace === `scout-${stage}` &&
          resource.metadata.name === "scout-egress-netpol",
      );
      expect(JSON.stringify(egressPolicy?.spec)).toContain('"port":7233');
      expect(JSON.stringify(egressPolicy?.spec)).toContain(
        '"kubernetes.io/metadata.name":"temporal"',
      );
    },
  );

  test("creates only prod and beta with thirty-day retention", () => {
    const namespaceJob = allScoutTemporalResources().find(
      (resource) =>
        resource.kind === "Job" &&
        resource.metadata.name === "temporal-namespace-init",
    );
    const namespaceJobMetadata = z
      .object({
        annotations: z.record(z.string(), z.string()),
      })
      .parse(namespaceJob?.metadata);
    expect(namespaceJobMetadata.annotations["argocd.argoproj.io/hook"]).toBe(
      "Sync",
    );
    expect(
      namespaceJobMetadata.annotations["argocd.argoproj.io/sync-wave"],
    ).toBe("1");
    const serialized = JSON.stringify(namespaceJob?.spec);
    expect(serialized).toContain("for namespace in prod beta");
    expect(serialized).toContain("--retention 720h");
    expect(serialized).not.toContain("for namespace in dev");
  });

  test("gives every central worker its active namespace and no drain", () => {
    const synthesized = allScoutTemporalResources();
    const workerNames = [
      "temporal-temporal-workflows-candidate",
      "temporal-temporal-agent-worker",
      "temporal-temporal-gateway",
      "temporal-temporal-home-worker",
      "temporal-temporal-reports-worker",
      "temporal-temporal-glitter-corpus-worker",
      "temporal-temporal-glitter-context-worker",
      "temporal-temporal-infra-worker",
      "temporal-temporal-repo-worker",
      "temporal-temporal-scout-worker",
    ];
    for (const name of workerNames) {
      const deployment = synthesized.find(
        (resource) =>
          resource.kind === "Deployment" && resource.metadata.name === name,
      );
      const serialized = JSON.stringify(deployment?.spec);
      expect(serialized, name).toContain(
        '"name":"TEMPORAL_NAMESPACE","value":"prod"',
      );
      if (name === "temporal-temporal-gateway") {
        expect(serialized, name).toContain(
          '"name":"TEMPORAL_SCHEDULE_RECONCILIATION","value":"auto"',
        );
      }
    }
  });

  test("allows both Scout stages into the Temporal frontend", () => {
    const temporalIngress = allScoutTemporalResources().find(
      (resource) =>
        resource.kind === "NetworkPolicy" &&
        resource.metadata.namespace === "temporal" &&
        resource.metadata.name === "temporal-server-netpol",
    );
    const serialized = JSON.stringify(temporalIngress?.spec);
    expect(serialized).toContain('"kubernetes.io/metadata.name":"scout-beta"');
    expect(serialized).toContain('"kubernetes.io/metadata.name":"scout-prod"');
    expect(serialized).toContain('"app":"scout-backend"');
    expect(serialized).toContain('"worker-family":"scout-beta-workflows"');
    expect(serialized).toContain('"worker-family":"scout-prod-workflows"');
    expect(serialized).toContain('"port":7233');
  });
});

describe("Scout beta workflow candidate", () => {
  test("bootstraps a credentialless beta candidate without cutting over", () => {
    const synthesized = betaResourcesWithWorkflowCandidate();
    const deployment = synthesized.find(
      (resource) =>
        resource.kind === "Deployment" &&
        resource.metadata.namespace === "scout-beta" &&
        resource.metadata.name === "scout-beta-scout-workflow-worker-candidate",
    );
    const spec = WorkflowDeploymentSpecSchema.parse(deployment?.spec);
    expect(deployment?.metadata["annotations"]).toEqual({
      "argocd.argoproj.io/sync-wave": "-2",
    });
    expect(spec.template.spec.automountServiceAccountToken).toBe(false);
    expect(spec.template.spec.containers).toHaveLength(1);
    const container = spec.template.spec.containers[0];
    expect(container?.command).toEqual(["bun"]);
    expect(container?.args).toEqual(["run", "src/temporal/workflow-worker.ts"]);
    expect(container?.env).toEqual([
      { name: "TZ", value: "America/Los_Angeles" },
      { name: "ENVIRONMENT", value: "beta" },
      {
        name: "TEMPORAL_ADDRESS",
        value:
          "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
      },
      { name: "TEMPORAL_METRICS_ADDRESS", value: "0.0.0.0:9464" },
      { name: "TEMPORAL_NAMESPACE", value: "beta" },
      {
        name: "TEMPORAL_WORKER_DEPLOYMENT_NAME",
        value: "scout-beta-workflows",
      },
    ]);
    expect(container?.env.every((entry) => entry.valueFrom === undefined)).toBe(
      true,
    );
    expect(container?.volumeMounts).toEqual([
      {
        mountPath: "/tmp",
        name: "scout-beta-workflows-candidate-tmp",
      },
    ]);
    expect(spec.template.spec.volumes).toEqual([
      expect.objectContaining({ name: "scout-beta-workflows-candidate-tmp" }),
    ]);

    expect(
      synthesized.some(
        (resource) =>
          resource.kind === "Deployment" &&
          resource.metadata.namespace === "scout-prod" &&
          resource.metadata.name.includes("scout-workflow-worker"),
      ),
    ).toBe(false);
  });

  test("restricts the beta candidate to DNS, Temporal, and metrics", () => {
    const policy = betaResourcesWithWorkflowCandidate().find(
      (resource) =>
        resource.kind === "NetworkPolicy" &&
        resource.metadata.namespace === "scout-beta" &&
        resource.metadata.name === "scout-workflow-worker-netpol",
    );
    const serialized = JSON.stringify(policy?.spec);
    expect(policy?.metadata["annotations"]).toEqual({
      "argocd.argoproj.io/sync-wave": "-2",
    });
    expect(serialized).toContain('"worker-family":"scout-beta-workflows"');
    expect(serialized).toContain('"port":53');
    expect(serialized).toContain('"port":7233');
    expect(serialized).toContain('"port":9464');
    expect(serialized).not.toContain('"port":5432');
    expect(serialized).not.toContain('"port":443');
  });
  test("only source recipes are synthesized; frozen pools own deployed builds", () => {
    const recipes = allScoutTemporalResources().filter(
      (resource) =>
        resource.kind === "Deployment" &&
        resource.metadata.name.includes("scout-workflow-worker"),
    );
    expect(recipes.map((resource) => resource.metadata.name)).toEqual([
      "scout-beta-scout-workflow-worker-candidate",
      "scout-prod-scout-workflow-worker-candidate",
    ]);
    for (const recipe of recipes)
      expect(
        WorkflowDeploymentSpecSchema.parse(recipe.spec).template.spec
          .containers[0]?.image,
      ).toContain("required `Delivery requires image:scout-for-lol`");
  });
});

test("keeps the production recipe credentialless with its exact network identity", () => {
  const resources = prodResourcesWithWorkflowCandidate();
  const recipe = resources.find(
    (resource) =>
      resource.kind === "Deployment" &&
      resource.metadata.name === "scout-prod-scout-workflow-worker-candidate",
  );
  const spec = WorkflowDeploymentSpecSchema.parse(recipe?.spec);
  expect(spec.template.spec.automountServiceAccountToken).toBe(false);
  expect(
    spec.template.spec.containers[0]?.env.every(
      (env) => env.valueFrom === undefined,
    ),
  ).toBe(true);
  const policy = resources.find(
    (resource) =>
      resource.kind === "NetworkPolicy" &&
      resource.metadata.name === "scout-workflow-worker-netpol",
  );
  expect(JSON.stringify(policy?.spec)).toContain(
    '"worker-family":"scout-prod-workflows"',
  );
});
