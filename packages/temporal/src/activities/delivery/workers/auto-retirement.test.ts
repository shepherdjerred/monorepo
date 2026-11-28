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

  it("still proposes for later environments when one refuses, then fails the tick", async () => {
    const requested: string[] = [];
    await expect(
      proposeDrainedRetirements(
        candidates,
        () => Promise.resolve(),
        (workerId) => {
          requested.push(workerId);
          return workerId === "serving"
            ? Promise.reject(
                new Error("Environment temporal/prod is not active"),
              )
            : Promise.resolve();
        },
      ),
    ).rejects.toThrow("not active");
    expect(requested).toEqual(["serving", "pinned"]);
  });

  it("skips workers owning live routing and environments whose accepted candidate lags live routing before running proofs (AI-642)", async () => {
    const proved: string[] = [];
    const requested: string[] = [];
    const laggingCandidates: {
      environments: {
        environmentId: string;
        generation: number;
        pool: { name: string; candidateBuildId?: string };
        workers: { id: string; generation: number; buildId: string }[];
      }[];
    } = {
      environments: [
        {
          environmentId: "temporal/prod",
          generation: 7,
          pool: { name: "central", candidateBuildId: "0".repeat(40) },
          workers: [
            { id: "live-promoted", generation: 0, buildId: "a".repeat(40) },
            { id: "drained-old", generation: 1, buildId: "b".repeat(40) },
          ],
        },
        {
          environmentId: "scout-for-lol/prod",
          generation: 4,
          pool: { name: "scout" },
          workers: [
            { id: "live-ramping", generation: 0, buildId: "e".repeat(40) },
            { id: "drained-ready", generation: 1, buildId: "f".repeat(40) },
          ],
        },
      ],
    };
    const result = await proposeDrainedRetirements(
      laggingCandidates,
      async (_pool, workerId) => {
        proved.push(workerId);
      },
      async (workerId) => {
        requested.push(workerId);
      },
      async (observedPool) =>
        observedPool.name === "central"
          ? [{ currentBuildId: "a".repeat(40), rampingBuildId: null }]
          : [
              {
                currentBuildId: "d".repeat(40),
                rampingBuildId: "e".repeat(40),
              },
            ],
    );
    expect(proved).toEqual(["drained-ready"]);
    expect(requested).toEqual(["drained-ready"]);
    expect(result).toEqual({
      requested: [
        { environmentId: "scout-for-lol/prod", workerId: "drained-ready" },
      ],
      skipped: [
        {
          environmentId: "temporal/prod",
          workerId: "live-promoted",
          reason:
            "Environment accepted worker lags live Temporal routing; settle acceptance before retiring hosts",
        },
        {
          environmentId: "temporal/prod",
          workerId: "drained-old",
          reason:
            "Environment accepted worker lags live Temporal routing; settle acceptance before retiring hosts",
        },
        {
          environmentId: "scout-for-lol/prod",
          workerId: "live-ramping",
          reason: "Retained worker still owns current or ramping routing",
        },
      ],
    });
  });
});
