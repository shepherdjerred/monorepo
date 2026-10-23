import { describe, expect, test } from "vitest";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { RecipeDefinitionSchema } from "@shepherdjerred/delivery/model-contract";
import { workerImageProofInput } from "#lib/delivery/workers/worker-image-proof.ts";
import { renderApplication } from "#lib/delivery/model/application.ts";
import { detail as arcadeDetail, recipe } from "#lib/delivery/model/testing.ts";
import {
  PLAN,
  STABLE,
  chart,
  definition,
  planEvidence,
  temporal,
} from "#lib/delivery/workers/model-worker-fixture.ts";
import {
  runWorkerRolloutStep,
  workerRolloutPreflight,
  type WorkerRolloutEffects,
} from "./worker-rollout.ts";

const KEY = "step-worker-rollout";

/** The rollout step mid-flight: intent, a planned preflight, then `jobs` settled. */
function rolling(jobs: string[]) {
  return temporal(
    [
      { key: KEY, status: "running" },
      { key: "worker-preflight", status: "succeeded" },
      ...jobs.map((job) => ({
        key: `worker-${job}`,
        status: "succeeded" as const,
      })),
    ],
    [planEvidence()],
  );
}

/** Effects that journal every call; `states` are the successive reloads. */
function effects(states: DeploymentDetail[], deployments: unknown[] = []) {
  const calls: string[] = [];
  let reload = 0;
  const recorded: WorkerRolloutEffects = {
    load: async () => {
      calls.push("load");
      const state = states[Math.min(reload, states.length - 1)];
      reload += 1;
      if (state === undefined) throw new Error("No reload fixture");
      return state;
    },
    record: async (_current, key, status) => {
      calls.push(`record ${key} ${status}`);
    },
    inspectImages: async () => {
      calls.push("inspect");
    },
    routing: async () => {
      calls.push("routing");
    },
    deployments: async () => {
      calls.push("deployments");
      return deployments;
    },
    hosts: async () => {
      calls.push("hosts");
    },
    prepare: async () => {
      calls.push("prepare");
      return PLAN;
    },
    step: async (_id, plan, action) => {
      expect(plan).toEqual(PLAN);
      calls.push(`step ${action}`);
    },
  };
  return { calls, effects: recorded };
}

describe("worker-rollout preflight (E5)", () => {
  test("a recipe without a worker step has no worker preflight", async () => {
    const run = effects([]);
    const plain = arcadeDetail(
      recipe(
        { repoURL: "https://chartmuseum.tailnet-1a49.ts.net", chart: "arcade" },
        "chart:arcade",
      ),
      chart,
    );
    await workerRolloutPreflight(plain, run.effects);
    expect(run.calls).toEqual([]);
  });

  test("proves images and routes before the Application changes", async () => {
    const run = effects([]);
    await workerRolloutPreflight(
      temporal([{ key: "worker-prior-source", status: "succeeded" }]),
      run.effects,
    );
    expect(run.calls).toEqual(["inspect", "routing", "deployments"]);
    const resumed = effects([]);
    await workerRolloutPreflight(
      temporal([
        { key: "worker-prior-source", status: "succeeded" },
        { key: "worker-image-provenance", status: "succeeded" },
      ]),
      resumed.effects,
    );
    expect(resumed.calls).toEqual(["routing", "deployments"]);
  });

  test("refuses without the claim's prior source, or with a legacy poller", async () => {
    await expect(
      workerRolloutPreflight(temporal([]), effects([]).effects),
    ).rejects.toThrow(/prior worker source/u);
    const legacy = {
      metadata: { name: "temporal-worker" },
      spec: {
        replicas: 1,
        template: {
          metadata: { labels: { "worker-family": "central-workflows" } },
          spec: {
            containers: [
              {
                image: `docker.io/shepherdjerred/temporal-worker@sha256:${"a".repeat(64)}`,
                env: [{ name: "GIT_SHA", value: STABLE }],
              },
            ],
          },
        },
      },
    };
    await expect(
      workerRolloutPreflight(
        temporal([{ key: "worker-prior-source", status: "succeeded" }]),
        effects([], [legacy]).effects,
      ),
    ).rejects.toThrow(/Legacy worker pollers/u);
  });
});

describe("worker-rollout step (E5)", () => {
  test("records intent, proves hosts, plans, promotes, verifies, then settles", async () => {
    const synced = temporal([{ key: "step-sync", status: "succeeded" }]);
    const planned = rolling([]);
    const promoted = rolling(["promote"]);
    const verified = rolling(["promote", "verify"]);
    const run = effects([planned, promoted, verified]);
    await runWorkerRolloutStep(synced, KEY, run.effects);
    expect(run.calls).toEqual([
      `record ${KEY} running`,
      "hosts",
      "prepare",
      "load",
      "step promote",
      "load",
      "step verify",
      "load",
      `record ${KEY} succeeded`,
    ]);
  });

  test("a resumed step routes by the recorded plan and skips settled Jobs", async () => {
    const resumed = rolling(["promote"]);
    const verified = rolling(["promote", "verify"]);
    const run = effects([resumed, verified]);
    await runWorkerRolloutStep(resumed, KEY, run.effects);
    expect(run.calls).toEqual([
      "hosts",
      "load",
      "step verify",
      "load",
      `record ${KEY} succeeded`,
    ]);
  });

  test("a settled preflight without its recorded plan is refused", async () => {
    const unplanned = temporal([
      { key: KEY, status: "running" },
      { key: "worker-preflight", status: "succeeded" },
    ]);
    await expect(
      runWorkerRolloutStep(unplanned, KEY, effects([unplanned]).effects),
    ).rejects.toThrow(/exactly one routing plan/u);
  });
});

describe("model worker rendering (E5)", () => {
  test("the sync renders the retained-host pool and the proof renders the same values", () => {
    const current = temporal([]);
    const parsed = RecipeDefinitionSchema.parse(definition);
    if (parsed.kind !== "kubernetes-application")
      throw new Error("temporal is a Kubernetes application recipe");
    const rendered = renderApplication(current, parsed);
    expect(
      rendered.source.helm?.parameters.map((parameter) => parameter.name),
    ).toEqual(["delivery.images.temporal-worker", "delivery.workerPool"]);
    const proof = workerImageProofInput(current);
    expect(proof.controlPlane?.selection).toMatchObject({
      application: "temporal",
      environmentId: "temporal/prod",
      chart: "temporal",
      revision: "1.0.0",
      namespace: "temporal",
    });
    expect(
      Object.keys(proof.controlPlane?.selection.parameters ?? {}).toSorted(),
    ).toEqual(["delivery.images.temporal-worker", "delivery.workerPool"]);
  });
});
