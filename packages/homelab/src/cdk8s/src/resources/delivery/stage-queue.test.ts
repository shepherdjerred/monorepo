import { App, Chart } from "cdk8s";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  CI_CLUSTER_QUEUE,
  DELIVERY_CLUSTER_QUEUE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import { createDeliveryJobs } from "./jobs.ts";

const LocalQueue = z.object({
  kind: z.literal("LocalQueue"),
  metadata: z.object({ name: z.string(), namespace: z.string() }),
  spec: z.object({ clusterQueue: z.string() }),
});

/**
 * A LocalQueue's ClusterQueue is immutable, so the reserved queue is a new
 * LocalQueue. Jobs from workers that predate it still name `default`.
 */
it("queues new stage Jobs on Delivery's reserved ClusterQueue beside the legacy CI queue", () => {
  for (const profile of ["worker", "platform"] as const) {
    const chart = new Chart(new App(), `${profile}-stage-queue`, {
      namespace: "temporal",
    });
    createDeliveryJobs(
      chart,
      profile,
      `${profile}-registry`,
      profile === "platform" ? "platform-argocd" : undefined,
    );
    const queues = chart.toJson().flatMap((raw) => {
      const parsed = LocalQueue.safeParse(raw);
      return parsed.success
        ? [
            [
              parsed.data.metadata.namespace,
              parsed.data.metadata.name,
              parsed.data.spec.clusterQueue,
            ],
          ]
        : [];
    });
    const namespace = `delivery-${profile}-jobs`;
    expect(queues).toEqual([
      [namespace, "delivery", DELIVERY_CLUSTER_QUEUE],
      [namespace, "default", CI_CLUSTER_QUEUE],
    ]);
  }
});
