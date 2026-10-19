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
  lostCurrentResponse: boolean;
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
    return json({});
  }
  if (command.includes("set-current-version")) {
    state.current = CANDIDATE;
    if (state.lostCurrentResponse) {
      state.lostCurrentResponse = false;
      throw new Error("Lost routing response");
    }
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
    lostCurrentResponse: false,
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
  test("new controller code keeps replay and canaries on the old immutable candidate", async () => {
    const controller = fixture({ checkout: "c".repeat(40) });
    const candidate = fixture();
    const prepared = await prepareDeliveryWorkerRollout(
      detail(),
      connection,
      controller.run,
      candidate.run,
    );
    expect(prepared.candidateBuildId).toBe(CANDIDATE);
    await stepDeliveryWorkerRollout(
      { detail: detail(), plan: prepared, action: "promote", connection },
      controller.run,
      candidate.run,
    );
    expect(
      controller.commands.some(
        (argv) => argv[0] === "bun" || argv[0] === "git",
      ),
    ).toBe(false);
    expect(
      controller.commands.some((argv) => argv.includes("set-current-version")),
    ).toBe(true);
    expect(
      candidate.commands.every(
        (argv) => argv[0] === "bun" || argv[0] === "git",
      ),
    ).toBe(true);
    expect(
      candidate.commands.some((argv) =>
        argv.includes("replay:candidate-histories"),
      ),
    ).toBe(true);
    expect(
      candidate.commands.some(
        (argv) => argv.includes("--build-id") && argv.includes(CANDIDATE),
      ),
    ).toBe(true);
  });
  test("a controller checkout matching the candidate cannot hide a wrong candidate checkout", async () => {
    const controller = fixture();
    const candidate = fixture({ checkout: STABLE });
    await expect(
      prepareDeliveryWorkerRollout(
        detail(),
        connection,
        controller.run,
        candidate.run,
      ),
    ).rejects.toThrow("does not match candidate");
    expect(candidate.commands.some((argv) => argv[0] === "bun")).toBe(false);
    await expect(
      stepDeliveryWorkerRollout(
        { detail: detail(), plan: plan(), action: "promote", connection },
        controller.run,
        candidate.run,
      ),
    ).rejects.toThrow("does not match candidate");
    expect(
      controller.commands.some((argv) => argv.includes("set-current-version")),
    ).toBe(false);
  });
});
describe("PostgreSQL-owned routing effects", () => {
  test("central directly promotes both namespaces and safely inspects a lost response", async () => {
    const prod = fixture();
    const beta = fixture({ lostCurrentResponse: true });
    const run: RolloutCommandRunner = async (command) => {
      const namespace = command[command.indexOf("--namespace") + 1];
      return await (namespace === "beta" ? beta.run : prod.run)(command);
    };
    const prepared = await prepareDeliveryWorkerRollout(
      detail(),
      connection,
      run,
    );
    expect(prepared).toEqual(plan());
    const input = {
      detail: detail(),
      plan: prepared,
      action: "promote" as const,
      connection,
    };
    await expect(stepDeliveryWorkerRollout(input, run)).rejects.toThrow(
      "Lost routing response",
    );
    const receipt = await stepDeliveryWorkerRollout(input, run);
    expect(receipt.evidence).toHaveLength(2);
    await stepDeliveryWorkerRollout({ ...input, action: "verify" }, run);
    for (const worker of [prod, beta]) {
      expect(worker.state.current).toBe(CANDIDATE);
      expect(
        worker.commands.filter((command) =>
          command.includes("set-current-version"),
        ),
      ).toHaveLength(1);
      expect(
        worker.commands.some((command) =>
          command.includes("set-ramping-version"),
        ),
      ).toBe(false);
      expect(
        worker.commands.some(
          (command) =>
            command.includes("--routing") && command.includes("normal"),
        ),
      ).toBe(true);
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
          action: "promote",
          connection,
        },
        run,
      ),
    ).rejects.toThrow("every served namespace");
    expect(commands).toHaveLength(0);
  });
  test("prepares exact candidate using replay, pinned canary and live stable pollers", async () => {
    const { run, commands } = fixture();
    expect(
      await prepareDeliveryWorkerRollout(detail(), connection, run),
    ).toEqual(plan());
    expect(
      commands.some((argv) => argv.includes("replay:candidate-histories")),
    ).toBe(true);
    expect(
      commands.some(
        (argv) =>
          argv.includes("scripts/rollout/worker-deployment-canary.ts") &&
          argv.includes("--build-id"),
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
  test("foreign current, existing ramp and a forged plan cannot mutate routing", async () => {
    for (const overrides of [
      { current: "c".repeat(40) },
      { ramping: CANDIDATE, percentage: 10 },
    ]) {
      const { run, commands } = fixture(overrides);
      await expect(
        stepDeliveryWorkerRollout(
          { detail: detail(), plan: plan(), action: "promote", connection },
          run,
        ),
      ).rejects.toThrow();
      expect(
        commands.some((argv) => argv.includes("set-current-version")),
      ).toBe(false);
    }
    const { run, commands } = fixture();
    await expect(
      stepDeliveryWorkerRollout(
        {
          detail: detail(),
          plan: { ...plan(), deploymentId: "other" },
          action: "promote",
          connection,
        },
        run,
      ),
    ).rejects.toThrow("frozen deployment");
    expect(commands).toHaveLength(0);
  });
  test("a failed pinned candidate canary prevents any routing mutation", async () => {
    const base = fixture();
    const run: RolloutCommandRunner = async (command) => {
      if (command[0] === "bun") throw new Error("Candidate canary failed");
      return await base.run(command);
    };
    await expect(
      stepDeliveryWorkerRollout(
        { detail: detail(), plan: plan(), action: "promote", connection },
        run,
      ),
    ).rejects.toThrow("Candidate canary failed");
    expect(
      base.commands.some((argv) => argv.includes("set-current-version")),
    ).toBe(false);
  });
  test("normal canary failure or route change prevents verification", async () => {
    for (const failure of ["canary", "route"]) {
      const base = fixture({ current: CANDIDATE });
      const run: RolloutCommandRunner = async (command) => {
        if (command.includes("--routing")) {
          if (failure === "canary")
            throw new Error("Normally routed canary failed");
          base.state.current = STABLE;
        }
        return await base.run(command);
      };
      await expect(
        stepDeliveryWorkerRollout(
          { detail: detail(), plan: plan(), action: "verify", connection },
          run,
        ),
      ).rejects.toThrow();
      expect(
        base.commands.some((argv) => argv.includes("set-current-version")),
      ).toBe(false);
    }
  });
});
