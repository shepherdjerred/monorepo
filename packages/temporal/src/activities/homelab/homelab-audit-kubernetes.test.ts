import { describe, expect, test } from "vitest";
import { interpretKubernetesWorkloads } from "./homelab-audit-kubernetes.ts";

function podWorkload(restartCount: number) {
  return {
    items: [
      {
        kind: "Pod" as const,
        metadata: { name: "api-1", namespace: "service" },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "api", ready: false, restartCount }],
        },
      },
    ],
  };
}

describe("Kubernetes workload condition identities", () => {
  test("keeps pod findings stable as restart counters change", () => {
    const first = interpretKubernetesWorkloads(podWorkload(1));
    const later = interpretKubernetesWorkloads(podWorkload(25));

    expect(first.findings[0]?.detail).not.toBe(later.findings[0]?.detail);
    expect(first.findings[0]?.id).toBe("kubernetes/pod/service/api-1");
    expect(first.findings[0]?.condition).toBe(later.findings[0]?.condition);
  });

  test("classifies replica conditions without including changing counts", () => {
    const result = interpretKubernetesWorkloads({
      items: [
        {
          kind: "Deployment",
          metadata: { name: "api", namespace: "service" },
          spec: { replicas: 2 },
          status: { availableReplicas: 0, updatedReplicas: 0 },
        },
      ],
    });

    expect(result.findings[0]).toMatchObject({
      id: "kubernetes/deployment/service/api",
      condition: JSON.stringify({ available: "none", updated: "none" }),
    });
  });
});
