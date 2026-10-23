import { describe, expect, test, vi } from "vitest";
import type * as Activity from "@temporalio/activity";
import type * as Client from "#lib/delivery/client.ts";

const sent = vi.hoisted(() => {
  const bodies: { path: string; body: unknown }[] = [];
  return { bodies };
});
vi.mock("@temporalio/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof Activity>()),
  Context: {
    current: () => ({
      info: {
        workflowExecution: {
          workflowId: "delivery/deployment-1/successor",
          runId: "successor-run",
        },
      },
    }),
  },
}));
vi.mock("#lib/delivery/client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Client>()),
  deliveryRequest: (path: string, _schema: unknown, body: unknown) => {
    sent.bodies.push({ path, body });
    return Promise.resolve({});
  },
}));

const { failDeliveryHandoff } = await import("./handoff.ts");

describe("successor handoff failure (D8)", () => {
  test("the successor reports its failure under its own executor identity", async () => {
    await failDeliveryHandoff("deployment-1");
    expect(sent.bodies).toEqual([
      {
        path: "deployments/deployment-1/finish",
        body: expect.objectContaining({
          status: "failed",
          recoveryRequired: true,
          executor: {
            workflowId: "delivery/deployment-1/successor",
            workflowRunId: "successor-run",
          },
        }),
      },
    ]);
  });
});
