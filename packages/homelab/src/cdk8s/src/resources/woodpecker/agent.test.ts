import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parse } from "yaml";
import { z } from "zod";
import { createWoodpeckerAgent } from "./agent.ts";

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    replicas: z.number(),
    strategy: z.object({ type: z.string() }),
    template: z.object({
      spec: z.object({
        serviceAccountName: z.string(),
        affinity: z.unknown(),
        containers: z.array(
          z.object({
            env: z.array(
              z.object({
                name: z.string(),
                value: z.string().optional(),
                valueFrom: z.unknown().optional(),
              }),
            ),
          }),
        ),
      }),
    }),
  }),
});

function agents() {
  const app = new App();
  createWoodpeckerAgent(
    new Chart(app, "woodpecker", { disableResourceNameHashes: true }),
  );
  return app
    .synthYaml()
    .split(/^---$/m)
    .map((document): unknown => parse(document))
    .filter(
      (document) =>
        z.object({ kind: z.literal("Deployment") }).safeParse(document).success,
    )
    .map((document) => DeploymentSchema.parse(document));
}

function environment(
  agent: z.infer<typeof DeploymentSchema>,
): Map<string, string | undefined> {
  const container = agent.spec.template.spec.containers[0];
  if (container === undefined) throw new Error("agent has no container");
  return new Map(container.env.map((entry) => [entry.name, entry.value]));
}

describe("dedicated CI agent pools", () => {
  it("uses only the four mandatory-label pools after the legacy drain", () => {
    const deployments = agents();
    expect(deployments).toHaveLength(4);
    for (const [pool, cap, queue, volume] of [
      ["pr", "6", "default", "16G"],
      ["main", "2", "default", "16G"],
      ["review", "3", "ci-gates", "1G"],
      ["completion", "1", "ci-gates", "1G"],
    ] as const) {
      const agent = deployments.find(
        (entry) =>
          entry.metadata.name === `woodpecker-woodpecker-agent-${pool}`,
      );
      if (agent === undefined) throw new Error(`missing ${pool} agent`);
      const env = environment(agent);
      expect(env.get("WOODPECKER_MAX_WORKFLOWS")).toBe(cap);
      expect(env.get("WOODPECKER_AGENT_LABELS")).toBe(
        `!ci-pool=${pool},kueue.x-k8s.io/priority-class=*`,
      );
      expect(env.get("WOODPECKER_BACKEND_K8S_POD_LABELS")).toBe(
        JSON.stringify({ "kueue.x-k8s.io/queue-name": queue }),
      );
      expect(env.get("WOODPECKER_BACKEND_K8S_VOLUME_SIZE")).toBe(volume);
    }
    const legacy = deployments.find(
      (entry) => entry.metadata.name === "woodpecker-woodpecker-agent",
    );
    expect(legacy).toBeUndefined();
  });

  it("keeps every agent on liskov with the existing native-secret and pod guards", () => {
    for (const agent of agents()) {
      const env = environment(agent);
      expect(agent.spec.replicas).toBe(1);
      expect(agent.spec.strategy.type).toBe("Recreate");
      expect(agent.spec.template.spec.affinity).toEqual({
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  {
                    key: "kubernetes.io/hostname",
                    operator: "In",
                    values: ["liskov"],
                  },
                ],
              },
            ],
          },
        },
      });
      expect(agent.spec.template.spec.serviceAccountName).toBe(
        "woodpecker-agent",
      );
      expect(env.get("WOODPECKER_BACKEND_K8S_NAMESPACE")).toBe("woodpecker-ci");
      expect(env.get("WOODPECKER_BACKEND_K8S_PRIORITY_CLASS")).toBe(
        "batch-low",
      );
      expect(env.get("WOODPECKER_BACKEND_K8S_ALLOW_NATIVE_SECRETS")).toBe(
        "true",
      );
      expect(env.get("WOODPECKER_BACKEND_K8S_POD_LABELS_ALLOW_FROM_STEP")).toBe(
        "true",
      );
    }
  });
});
