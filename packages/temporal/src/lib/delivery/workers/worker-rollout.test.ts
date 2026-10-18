import { describe, expect, test } from "vitest";
import {
  DeploymentDetailSchema,
  workerHostSpecification,
} from "@shepherdjerred/delivery/contract";
import type { WorkerRolloutPlan } from "@shepherdjerred/delivery/contract";
import {
  prepareDeliveryWorkerRollout,
  stepDeliveryWorkerRollout,
} from "./worker-rollout.ts";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";

const CANDIDATE = "b".repeat(40);
const STABLE = "a".repeat(40);
const NOW = new Date("2026-10-16T12:00:00.000Z");
const timestamp = "2026-10-16T00:00:00.000Z";
const connection = { address: "temporal.test:7233" };
const detail = () =>
  DeploymentDetailSchema.parse({
    deployment: {
      id: "deployment/1",
      requestId: "request/1",
      environmentId: "temporal/prod",
      serviceId: "temporal",
      versionSetRevisionId: "version/1",
      pipelineRevisionId: "pipeline/1",
      configurationRevision: "config/1",
      configuration: {},
      expectedGeneration: 0,
      kind: "deploy",
      status: "running",
      requestedBy: "operator",
      message: null,
      cancelRequested: false,
      recoveryRequired: false,
      createdAt: timestamp,
      startedAt: timestamp,
      finishedAt: null,
      workerSnapshot: {
        schema: "delivery-worker-pool/v1",
        environmentId: "temporal/prod",
        environmentGeneration: 0,
        target: "central",
        candidateBuildId: CANDIDATE,
        versions: [STABLE, CANDIDATE].map((buildId) => ({
          id: `worker/${buildId}`,
          environmentId: "temporal/prod",
          buildId,
          artifactId: buildId === CANDIDATE ? "image/1" : "image/stable",
          artifactBuildId: `build/${buildId}`,
          sourceRevision: buildId,
          image: `docker.io/shepherdjerred/temporal-worker@sha256:${buildId.slice(0, 1).repeat(64)}`,
          digest: `sha256:${buildId.slice(0, 1).repeat(64)}`,
          introducedByDeploymentId: "deployment/0",
          host: workerHostSpecification("central"),
          replicas: 1,
          generation: 0,
          retiredAt: null,
        })),
      },
    },
    environment: {
      id: "temporal/prod",
      serviceId: "temporal",
      name: "prod",
      application: "temporal",
      pipelineRevisionId: "pipeline/1",
      configurationRevision: "config/1",
      configuration: {},
      automatic: true,
      promotionSourceEnvironmentId: null,
      generation: 1,
      approvalRequired: false,
      desiredVersionSetRevisionId: "version/1",
      observedVersionSetRevisionId: null,
      acceptedVersionSetRevisionId: null,
      observedAt: null,
      activeDeploymentId: "deployment/1",
      createdAt: timestamp,
    },
    versionSet: {
      id: "version/1",
      serviceId: "temporal",
      revision: 1,
      baseRevisionId: null,
      createdAt: timestamp,
      components: {
        worker: {
          id: "image/1",
          component: "worker",
          kind: "image",
          uri: "docker.io/shepherdjerred/temporal-worker",
          digest: `sha256:${"b".repeat(64)}`,
          version: "build-1",
          serviceId: "temporal",
          buildId: "build/1",
          sourceRevision: CANDIDATE,
          createdAt: timestamp,
        },
      },
    },
    pipeline: {
      id: "pipeline/1",
      createdAt: timestamp,
      definition: {
        kind: "argocd",
        application: "temporal",
        chartRepository: "https://chartmuseum.sjer.red",
        chartName: "temporal",
        chartComponent: "chart",
        parameters: {},
        workerRollout: {
          target: "central",
          imageComponent: "worker",
          runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"c".repeat(64)}`,
        },
      },
    },
    evidence: [],
    approvals: [],
    stages: [],
  });
type State = {
  current: string;
  ramping: string;
  percentage: number;
  changedAt: string;
  candidateFailures: number;
  checkout: string;
  lostRampResponse: boolean;
};
const json = (value: unknown) => ({
  stdout: JSON.stringify(value),
  stderr: "",
});
function metric(expression: string, state: State) {
  if (expression.includes("increase(temporal_worker_workflow_"))
    return state.candidateFailures;
  if (expression.includes("increase(") || expression.includes("time() -"))
    return 0;
  return expression.includes("count_over_time") ? 300 : 1;
}
function mutateRouting(command: string[], state: State) {
  if (command.includes("set-ramping-version")) {
    const offset = command.indexOf("--percentage");
    state.percentage = command.includes("--delete")
      ? 0
      : Number(command[offset + 1]);
    state.ramping = command.includes("--delete") ? "" : CANDIDATE;
    if (state.lostRampResponse) {
      state.lostRampResponse = false;
      throw new Error("Lost routing response");
    }
    return json({});
  }
  if (command.includes("set-current-version")) {
    state.current = CANDIDATE;
    return json({});
  }
  throw new Error(`Unexpected command: ${command.join(" ")}`);
}
function fixture(overrides: Partial<State> = {}) {
  const state: State = {
    current: STABLE,
    ramping: "",
    percentage: 0,
    changedAt: timestamp,
    candidateFailures: 0,
    checkout: CANDIDATE,
    lostRampResponse: false,
    ...overrides,
  };
  const commands: string[][] = [];
  const run: RolloutCommandRunner = async (argv) => {
    const command = [...argv];
    commands.push(command);
    if (command[0] === "docker")
      return json({
        os: "linux",
        architecture: "amd64",
        config: { Env: [`GIT_SHA=${CANDIDATE}`] },
      });
    if (command[0] === "git")
      return {
        stdout: command[1] === "rev-parse" ? state.checkout : "",
        stderr: "",
      };
    if (command[0] === "bun")
      return { stdout: "canary/replay passed", stderr: "" };
    if (command[1] === "prom") {
      const expression = command[3] ?? "";
      const value = metric(expression, state);
      return json({
        status: "success",
        data: {
          resultType: "vector",
          result: [{ value: [1_788_000_000, String(value)] }],
        },
      });
    }
    if (command.includes("describe-version"))
      return json({
        BuildID: CANDIDATE,
        taskQueuesInfos: [{ name: "monorepo-workflows", type: "workflow" }],
      });
    return command.includes("describe")
      ? json({
          name: "monorepo-central-workflows",
          versionSummaries: [
            { BuildID: STABLE, createTime: timestamp },
            { BuildID: CANDIDATE, createTime: timestamp },
          ],
          routingConfig: {
            currentVersionBuildID: state.current,
            rampingVersionBuildID: state.ramping,
            rampingVersionPercentage: state.percentage,
            currentVersionChangedTime: timestamp,
            rampingVersionChangedTime: timestamp,
            rampingVersionPercentageChangedTime: state.changedAt,
          },
        })
      : mutateRouting(command, state);
  };
  return { state, commands, run };
}
function plan(): WorkerRolloutPlan {
  return {
    target: "central",
    namespace: "prod",
    deploymentName: "monorepo-central-workflows",
    taskQueue: "monorepo-workflows",
    candidateBuildId: CANDIDATE,
    candidateImage: `docker.io/shepherdjerred/temporal-worker@sha256:${"b".repeat(64)}`,
    expectedCurrentBuildId: STABLE,
    routes: [
      { namespace: "prod", expectedCurrentBuildId: STABLE },
      { namespace: "beta", expectedCurrentBuildId: STABLE },
    ],
    deploymentId: "deployment/1",
  };
}
describe("PostgreSQL-owned worker rollout routing", () => {
  test("central routing prepares and ramps both namespaces, inspecting a partial lost response safely", async () => {
    const prod = fixture();
    const beta = fixture({ lostRampResponse: true });
    const run: RolloutCommandRunner = async (command) => {
      const namespace = command[command.indexOf("--namespace") + 1];
      return await (namespace === "beta" ? beta.run : prod.run)(command);
    };
    const prepared = await prepareDeliveryWorkerRollout(
      detail(),
      connection,
      run,
    );
    expect(prepared.routes.map((route) => route.namespace)).toEqual([
      "prod",
      "beta",
    ]);
    const input = {
      detail: detail(),
      plan: prepared,
      action: "start" as const,
      connection,
    };
    await expect(stepDeliveryWorkerRollout(input, run)).rejects.toThrow(
      "Lost routing response",
    );
    const receipt = await stepDeliveryWorkerRollout(input, run);
    expect(receipt.evidence).toHaveLength(2);
    for (const worker of [prod, beta]) {
      expect(worker.state.percentage).toBe(10);
      expect(
        worker.commands.filter((command) =>
          command.includes("set-ramping-version"),
        ),
      ).toHaveLength(1);
    }
  });
  test("central cannot route with a frozen plan omitting beta", async () => {
    const { run, commands } = fixture();
    await expect(
      stepDeliveryWorkerRollout(
        {
          detail: detail(),
          plan: {
            ...plan(),
            routes: [{ namespace: "prod", expectedCurrentBuildId: STABLE }],
          },
          action: "start",
          connection,
        },
        run,
      ),
    ).rejects.toThrow("every served namespace");
    expect(commands).toHaveLength(0);
  });
  test("prepares exact candidate using replay, canary and live stable pollers", async () => {
    const { run, commands } = fixture();
    expect(
      await prepareDeliveryWorkerRollout(detail(), connection, run),
    ).toEqual(plan());
    expect(
      commands.some((argv) => argv.includes("replay:candidate-histories")),
    ).toBe(true);
    expect(
      commands.some((argv) =>
        argv.includes("scripts/rollout/worker-deployment-canary.ts"),
      ),
    ).toBe(true);
    expect(
      commands.some(
        (argv) =>
          argv.includes("set-current-version") ||
          argv.includes("set-ramping-version"),
      ),
    ).toBe(false);
  });
  test("refuses a replay checkout different from the frozen artifact source", async () => {
    const { run } = fixture({ checkout: STABLE });
    await expect(
      prepareDeliveryWorkerRollout(detail(), connection, run),
    ).rejects.toThrow("does not match candidate");
  });
  test("lost start response can be inspected without repeating the routing mutation", async () => {
    const { run, commands } = fixture({ lostRampResponse: true });
    const input = {
      detail: detail(),
      plan: plan(),
      action: "start" as const,
      connection,
      now: NOW,
    };
    await expect(stepDeliveryWorkerRollout(input, run)).rejects.toThrow(
      "Lost routing response",
    );
    const result = await stepDeliveryWorkerRollout(input, run);
    expect(result.rampPercentage).toBe(10);
    expect(
      commands.filter((argv) => argv.includes("set-ramping-version")),
    ).toHaveLength(1);
  });
  test("explicit advance target prevents a duplicate call skipping an observation window", async () => {
    const { run, commands } = fixture({ ramping: CANDIDATE, percentage: 10 });
    const input = {
      detail: detail(),
      plan: plan(),
      action: "advance-50" as const,
      connection,
      now: NOW,
    };
    const first = await stepDeliveryWorkerRollout(input, run);
    const duplicate = await stepDeliveryWorkerRollout(input, run);
    expect(first.rampPercentage).toBe(50);
    expect(duplicate.rampPercentage).toBe(50);
    expect(
      commands.filter((argv) => argv.includes("set-ramping-version")),
    ).toHaveLength(1);
  });
  test("insufficient duration or candidate failures block ramp advancement", async () => {
    const fresh = fixture({
      ramping: CANDIDATE,
      percentage: 10,
      changedAt: NOW.toISOString(),
    });
    const input = {
      detail: detail(),
      plan: plan(),
      action: "advance-50" as const,
      connection,
      now: NOW,
    };
    await expect(stepDeliveryWorkerRollout(input, fresh.run)).rejects.toThrow(
      "observation period",
    );
    const unhealthy = fixture({
      ramping: CANDIDATE,
      percentage: 10,
      candidateFailures: 1,
    });
    await expect(
      stepDeliveryWorkerRollout(input, unhealthy.run),
    ).rejects.toThrow("failures");
    expect(
      unhealthy.commands.some((argv) => argv.includes("set-ramping-version")),
    ).toBe(false);
  });
  test("promotion sets current and clears ramp without touching a Git catalog", async () => {
    const { run, commands } = fixture({ ramping: CANDIDATE, percentage: 100 });
    const input = {
      detail: detail(),
      plan: plan(),
      action: "promote" as const,
      connection,
      now: NOW,
    };
    const first = await stepDeliveryWorkerRollout(input, run);
    const duplicate = await stepDeliveryWorkerRollout(input, run);
    expect(first.currentBuildId).toBe(CANDIDATE);
    expect(duplicate.rampPercentage).toBe(0);
    expect(
      commands.filter((argv) => argv.includes("set-current-version")),
    ).toHaveLength(1);
    expect(commands.filter((argv) => argv.includes("--delete"))).toHaveLength(
      1,
    );
    expect(commands.some((argv) => argv[0] === "git")).toBe(false);
  });
  test("changed current version or a forged plan cannot mutate routing", async () => {
    const changed = fixture({ current: "c".repeat(40) });
    await expect(
      stepDeliveryWorkerRollout(
        { detail: detail(), plan: plan(), action: "start", connection },
        changed.run,
      ),
    ).rejects.toThrow("outside this deployment");
    await expect(
      stepDeliveryWorkerRollout(
        {
          detail: detail(),
          plan: { ...plan(), deploymentId: "other" },
          action: "start",
          connection,
        },
        changed.run,
      ),
    ).rejects.toThrow("frozen deployment");
    expect(
      changed.commands.some((argv) => argv.includes("set-ramping-version")),
    ).toBe(false);
  });
});
