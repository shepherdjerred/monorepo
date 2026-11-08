import { describe, expect, it } from "vitest";
import { proposeDrainedRetirements } from "./auto-retirement.ts";

// The proof is injected; the pool only travels to it.
const pool = (name: string) => ({ name });

const candidates = {
  environments: [
    {
      environmentId: "temporal/prod",
      generation: 7,
      pool: pool("central"),
      workers: [
        { id: "serving", generation: 0, buildId: "a".repeat(40) },
        { id: "drained-1", generation: 2, buildId: "b".repeat(40) },
        { id: "drained-2", generation: 0, buildId: "c".repeat(40) },
      ],
    },
    {
      environmentId: "scout-for-lol/beta",
      generation: 3,
      pool: pool("scout"),
      workers: [{ id: "pinned", generation: 0, buildId: "d".repeat(40) }],
    },
  ],
};

describe("proposeDrainedRetirements", () => {
  it("requests one host per environment: the first whose proof passes", async () => {
    const proved: string[] = [];
    const requested: { workerId: string; body: unknown }[] = [];
    const result = await proposeDrainedRetirements(
      candidates,
      async (_pool, workerId) => {
        proved.push(workerId);
        if (workerId === "serving")
          throw new Error(
            "Retained worker still owns current or ramping routing",
          );
        if (workerId === "pinned")
          throw new Error("Retained worker still has open pinned executions");
      },
      async (workerId, body) => {
        requested.push({ workerId, body });
      },
    );
    expect(proved).toEqual(["serving", "drained-1", "pinned"]);
    expect(requested).toEqual([
      {
        workerId: "drained-1",
        body: { expectedEnvironmentGeneration: 7, expectedWorkerGeneration: 2 },
      },
    ]);
    expect(result).toEqual({
      requested: [{ environmentId: "temporal/prod", workerId: "drained-1" }],
      skipped: [
        {
          environmentId: "temporal/prod",
          workerId: "serving",
          reason: "Retained worker still owns current or ramping routing",
        },
        {
          environmentId: "scout-for-lol/beta",
          workerId: "pinned",
          reason: "Retained worker still has open pinned executions",
        },
      ],
    });
  });

  it("lets a refused request fail the tick instead of hiding it", async () => {
    await expect(
      proposeDrainedRetirements(
        candidates,
        () => Promise.resolve(),
        async () => {
          throw new Error(
            "Worker pool cannot change while a deployment is pending or active",
          );
        },
      ),
    ).rejects.toThrow("pending or active");
  });
});
