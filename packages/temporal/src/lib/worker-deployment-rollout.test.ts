import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import {
  executeWorkerDeploymentRollout,
  type WorkerDeploymentRolloutOptions,
} from "./worker-deployment-rollout.ts";
import type { RolloutCommandRunner } from "./worker-deployment-proofs.ts";

const CANDIDATE = "b".repeat(40);
const STABLE = "a".repeat(40);
const DEPLOYMENT = "monorepo-central-workflows";
const CANDIDATE_DIGEST = "b".repeat(64);
const STABLE_DIGEST = "a".repeat(64);
const createdDirectories: string[] = [];

type Fixture = {
  currentBuildId?: string;
  rampingBuildId?: string;
  rampPercentage?: number;
  rampChangedTime?: string;
  workflowPollers?: number;
  alerts?: number;
  historicalAlerts?: number;
  omitWorkflowQueue?: boolean;
  staleCandidate?: boolean;
  checkoutBuildId?: string;
  imageBuildId?: string;
  dirtyCheckout?: boolean;
};

function jsonResult(value: unknown): { stdout: string; stderr: string } {
  return { stdout: JSON.stringify(value), stderr: "" };
}

function prometheus(value: number): unknown {
  return {
    status: "success",
    data: {
      resultType: "vector",
      result: [{ metric: {}, value: [1_788_000_000, String(value)] }],
    },
  };
}

function failingCommandRunner(): Promise<never> {
  return Promise.reject(new Error("temporal failed with exit 1: unavailable"));
}

function deploymentDescription(fixture: Fixture): unknown {
  return {
    name: DEPLOYMENT,
    routingConfig: {
      currentVersionDeploymentName: DEPLOYMENT,
      currentVersionBuildID: fixture.currentBuildId ?? STABLE,
      rampingVersionDeploymentName:
        fixture.rampingBuildId === undefined ? "" : DEPLOYMENT,
      rampingVersionBuildID: fixture.rampingBuildId ?? "",
      rampingVersionPercentage: fixture.rampPercentage ?? 0,
      currentVersionChangedTime: "2026-08-27T00:00:00Z",
      rampingVersionChangedTime: "2026-08-28T00:00:00Z",
      rampingVersionPercentageChangedTime:
        fixture.rampChangedTime ?? "2026-08-28T00:00:00Z",
    },
    versionSummaries: [
      {
        deploymentName: DEPLOYMENT,
        BuildID: STABLE,
        createTime: "2026-08-27T00:00:00Z",
      },
      {
        deploymentName: DEPLOYMENT,
        BuildID: CANDIDATE,
        createTime: "2026-08-28T00:00:00Z",
      },
      ...(fixture.staleCandidate === true
        ? [
            {
              deploymentName: DEPLOYMENT,
              BuildID: "c".repeat(40),
              createTime: "2026-08-29T00:00:00Z",
            },
          ]
        : []),
    ],
  };
}

function metricValue(expression: string, fixture: Fixture): number {
  if (expression.includes("max_over_time")) {
    return fixture.historicalAlerts ?? 0;
  }
  if (expression.includes("ALERTS")) {
    return fixture.alerts ?? 0;
  }
  return fixture.workflowPollers ?? 1;
}

function fixtureRunner(
  fixture: Fixture,
  commands: string[][],
): RolloutCommandRunner {
  return (command) => {
    const args = [...command];
    commands.push(args);
    return Promise.resolve(fixtureCommandResult(args, fixture));
  };
}

function fixtureCommandResult(
  args: string[],
  fixture: Fixture,
): { stdout: string; stderr: string } {
  if (args.includes("describe-version")) {
    const buildId = args[args.indexOf("--build-id") + 1];
    return jsonResult({
      deploymentName: DEPLOYMENT,
      BuildID: buildId,
      taskQueuesInfos: fixture.omitWorkflowQueue
        ? []
        : [{ name: "monorepo-workflows", type: "workflow" }],
    });
  }
  if (args.includes("describe")) {
    return jsonResult(deploymentDescription(fixture));
  }
  if (args[0] === "toolkit" && args[1] === "prom") {
    const expression = args[3] ?? "";
    return jsonResult(prometheus(metricValue(expression, fixture)));
  }
  if (args[0] === "git") {
    return gitFixtureResult(args, fixture);
  }
  if (args[0] === "docker") {
    return jsonResult([`GIT_SHA=${fixture.imageBuildId ?? CANDIDATE}`]);
  }
  if (args.includes("set-current-version")) {
    const buildId = args[args.indexOf("--build-id") + 1];
    if (buildId === undefined) {
      throw new Error("fixture set-current-version is missing a build ID");
    }
    fixture.currentBuildId = buildId;
  }
  return jsonResult({ outcome: "ok" });
}

function gitFixtureResult(
  args: string[],
  fixture: Fixture,
): { stdout: string; stderr: string } {
  if (args.includes("status")) {
    return {
      stdout:
        fixture.dirtyCheckout === true ? " M src/workflows/test.ts\n" : "",
      stderr: "",
    };
  }
  return {
    stdout: `${fixture.checkoutBuildId ?? CANDIDATE}\n`,
    stderr: "",
  };
}

async function catalogPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "temporal-rollout-"));
  createdDirectories.push(directory);
  const catalogFile = path.join(directory, "catalog.json");
  await Bun.write(
    catalogFile,
    JSON.stringify({
      entries: [
        {
          name: "shepherdjerred/temporal-worker/workflows/candidate",
          value: `2.0.0-2@sha256:${CANDIDATE_DIGEST}`,
        },
        {
          name: "shepherdjerred/temporal-worker/workflows/stable",
          value: `2.0.0-1@sha256:${STABLE_DIGEST}`,
        },
      ],
    }),
  );
  return catalogFile;
}

async function options(
  action: WorkerDeploymentRolloutOptions["action"],
  now = new Date("2026-08-29T01:00:00Z"),
): Promise<WorkerDeploymentRolloutOptions> {
  const catalogFile = await catalogPath();
  const candidateStatePath = path.join(
    path.dirname(catalogFile),
    "pin-candidates-state.json",
  );
  await Bun.write(
    candidateStatePath,
    JSON.stringify({ schema: "pin-candidates-state/v1", pins: {} }),
  );
  return {
    action,
    address: "temporal.test:7233",
    namespace: "default",
    deploymentName: DEPLOYMENT,
    buildId: CANDIDATE,
    catalogPath: catalogFile,
    candidateStatePath,
    now,
  };
}

afterEach(async () => {
  await Promise.all(
    createdDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Worker Deployment rollout", () => {
  test("reports exact routing, poller, and alert state", async () => {
    const commands: string[][] = [];
    const status = await executeWorkerDeploymentRollout(
      await options("status"),
      fixtureRunner({}, commands),
    );
    expect(status).toMatchObject({
      currentBuildId: STABLE,
      candidateBuildId: CANDIDATE,
      rampPercentage: 0,
      workflowPollers: 1,
      activeTemporalAlerts: 0,
      candidateWorkflowQueues: ["monorepo-workflows"],
    });
    expect(
      commands.some((command) => command.includes("describe-version")),
    ).toBe(true);
  });

  test("passes TLS through to native Temporal commands when enabled", async () => {
    const commands: string[][] = [];
    const rolloutOptions = await options("status");
    rolloutOptions.tls = true;
    await executeWorkerDeploymentRollout(
      rolloutOptions,
      fixtureRunner({}, commands),
    );
    expect(
      commands
        .filter(
          (command) => command[0] === "toolkit" && command[1] === "temporal",
        )
        .every((command) => command.includes("--tls")),
    ).toBe(true);
  });

  test("starts at 10% only after replay, canary, poller, and alert proofs", async () => {
    const commands: string[][] = [];
    await executeWorkerDeploymentRollout(
      await options("start"),
      fixtureRunner({}, commands),
    );
    expect(commands).toContainEqual(["bun", "run", "test:workflows"]);
    expect(commands).toContainEqual([
      "bun",
      "run",
      "replay:candidate-histories",
    ]);
    expect(commands).toContainEqual(["git", "rev-parse", "HEAD"]);
    expect(commands).toContainEqual([
      "git",
      "status",
      "--porcelain=v1",
      "--untracked-files=no",
    ]);
    expect(
      commands.some(
        (command) =>
          command.some((argument) =>
            argument.endsWith("worker-deployment-canary.ts"),
          ) && command.includes(CANDIDATE),
      ),
    ).toBe(true);
    expect(
      commands.some(
        (command) =>
          command.includes("set-ramping-version") && command.includes("10"),
      ),
    ).toBe(true);
    expect(
      commands.filter(
        (command) =>
          command.includes("describe") && !command.includes("describe-version"),
      ),
    ).toHaveLength(3);
  });

  test("initializes an empty deployment with a stable version before ramping", async () => {
    const commands: string[][] = [];
    const rolloutOptions = await options("start");
    rolloutOptions.stableBuildId = STABLE;
    await executeWorkerDeploymentRollout(
      rolloutOptions,
      fixtureRunner({ currentBuildId: "" }, commands),
    );
    expect(
      commands.some(
        (command) =>
          command.includes("set-current-version") && command.includes(STABLE),
      ),
    ).toBe(true);
    expect(
      commands.some(
        (command) =>
          command.includes("set-ramping-version") && command.includes("10"),
      ),
    ).toBe(true);
  });

  test("advances 10 to 50 after 30 clean minutes and 50 to 100 after two hours", async () => {
    const firstCommands: string[][] = [];
    await executeWorkerDeploymentRollout(
      await options("advance", new Date("2026-08-29T00:31:00Z")),
      fixtureRunner(
        {
          rampingBuildId: CANDIDATE,
          rampPercentage: 10,
          rampChangedTime: "2026-08-29T00:00:00Z",
        },
        firstCommands,
      ),
    );
    expect(firstCommands.some((command) => command.includes("50"))).toBe(true);

    const secondCommands: string[][] = [];
    await executeWorkerDeploymentRollout(
      await options("advance", new Date("2026-08-29T02:01:00Z")),
      fixtureRunner(
        {
          rampingBuildId: CANDIDATE,
          rampPercentage: 50,
          rampChangedTime: "2026-08-29T00:00:00Z",
        },
        secondCommands,
      ),
    );
    expect(secondCommands.some((command) => command.includes("100"))).toBe(
      true,
    );
  });

  test("promotes after a 24-hour soak and advances the stable image pin", async () => {
    const commands: string[][] = [];
    const rolloutOptions = await options(
      "promote",
      new Date("2026-08-30T00:01:00Z"),
    );
    await executeWorkerDeploymentRollout(
      rolloutOptions,
      fixtureRunner(
        {
          rampingBuildId: CANDIDATE,
          rampPercentage: 100,
          rampChangedTime: "2026-08-29T00:00:00Z",
        },
        commands,
      ),
    );
    expect(
      commands.some((command) => command.includes("set-current-version")),
    ).toBe(true);
    expect(
      commands.some(
        (command) =>
          command.includes("set-ramping-version") &&
          command.includes("--delete"),
      ),
    ).toBe(true);
    expect(await Bun.file(rolloutOptions.catalogPath).text()).toContain(
      `"value": "2.0.0-2@sha256:${CANDIDATE_DIGEST}"`,
    );
    expect(await Bun.file(rolloutOptions.catalogPath).text()).not.toContain(
      `"value": "2.0.0-1@sha256:${STABLE_DIGEST}"`,
    );
  });

  test("validates the stable image pin before mutating live routing", async () => {
    const commands: string[][] = [];
    const rolloutOptions = await options(
      "promote",
      new Date("2026-08-30T00:01:00Z"),
    );
    await Bun.write(
      rolloutOptions.catalogPath,
      JSON.stringify({ entries: [{ name: "unrelated", value: "1.0.0" }] }),
    );

    await expect(
      executeWorkerDeploymentRollout(
        rolloutOptions,
        fixtureRunner(
          {
            rampingBuildId: CANDIDATE,
            rampPercentage: 100,
            rampChangedTime: "2026-08-29T00:00:00Z",
          },
          commands,
        ),
      ),
    ).rejects.toThrow("stable/candidate pins are missing");
    expect(
      commands.some((command) => command.includes("set-current-version")),
    ).toBe(false);
    expect(commands.some((command) => command.includes("--delete"))).toBe(
      false,
    );
  });
});

describe("Worker Deployment rollback and rejection", () => {
  test("rolls back only the active candidate ramp", async () => {
    const commands: string[][] = [];
    const rolloutOptions = await options("rollback");
    rolloutOptions.tls = true;
    await executeWorkerDeploymentRollout(
      rolloutOptions,
      fixtureRunner(
        { rampingBuildId: CANDIDATE, rampPercentage: 50 },
        commands,
      ),
    );
    expect(commands.some((command) => command.includes("--delete"))).toBe(true);
    expect(
      commands
        .filter(
          (command) => command[0] === "toolkit" && command[1] === "temporal",
        )
        .every((command) => command.includes("--tls")),
    ).toBe(true);
    const resetOptions = await options("rollback");
    const resetCommands: string[][] = [];
    await executeWorkerDeploymentRollout(
      resetOptions,
      fixtureRunner({}, resetCommands),
    );
    expect(resetCommands.some((command) => command.includes("--delete"))).toBe(
      false,
    );
  });

  test("resets a rejected candidate pin after its ramp is gone", async () => {
    const rolloutOptions = await options("rollback");
    const commands: string[][] = [];
    await executeWorkerDeploymentRollout(
      rolloutOptions,
      fixtureRunner({}, commands),
    );
    const catalog = await Bun.file(rolloutOptions.catalogPath).text();
    expect(catalog).toContain(
      `"name": "shepherdjerred/temporal-worker/workflows/candidate",\n      "value": "2.0.0-1@sha256:${STABLE_DIGEST}"`,
    );
    expect(commands.some((command) => command.includes("--delete"))).toBe(
      false,
    );
  });

  test("allows the exact active ramp to roll back after a newer build registers", async () => {
    const commands: string[][] = [];
    await executeWorkerDeploymentRollout(
      await options("rollback"),
      fixtureRunner(
        {
          rampingBuildId: CANDIDATE,
          rampPercentage: 50,
          staleCandidate: true,
        },
        commands,
      ),
    );
    expect(commands.some((command) => command.includes("--delete"))).toBe(true);
  });

  test("rejects replay from a checkout other than the candidate build", async () => {
    await expect(
      executeWorkerDeploymentRollout(
        await options("start"),
        fixtureRunner({ checkoutBuildId: STABLE }, []),
      ),
    ).rejects.toThrow("does not match candidate build");
  });

  test("rejects replay from a dirty candidate checkout", async () => {
    await expect(
      executeWorkerDeploymentRollout(
        await options("start"),
        fixtureRunner({ dirtyCheckout: true }, []),
      ),
    ).rejects.toThrow("tracked modifications");
  });

  test("rejects a ramp when an alert fired during the clean window", async () => {
    await expect(
      executeWorkerDeploymentRollout(
        await options("advance", new Date("2026-08-29T00:31:00Z")),
        fixtureRunner(
          {
            rampingBuildId: CANDIDATE,
            rampPercentage: 10,
            rampChangedTime: "2026-08-29T00:00:00Z",
            historicalAlerts: 1,
          },
          [],
        ),
      ),
    ).rejects.toThrow("alerts fired during the required 30m clean window");
  });

  test("rejects promotion when the candidate pin was built from another commit", async () => {
    await expect(
      executeWorkerDeploymentRollout(
        await options("promote", new Date("2026-08-30T00:01:00Z")),
        fixtureRunner(
          {
            rampingBuildId: CANDIDATE,
            rampPercentage: 100,
            rampChangedTime: "2026-08-29T00:00:00Z",
            imageBuildId: STABLE,
          },
          [],
        ),
      ),
    ).rejects.toThrow("was not built from");
  });

  test.each([
    [{ staleCandidate: true }, "stale"],
    [{ workflowPollers: 0 }, "healthy Workflow pollers"],
    [{ alerts: 2 }, "active Temporal alerts"],
    [{ omitWorkflowQueue: true }, "no registered monorepo-workflows"],
  ])("refuses unsafe state %o", async (fixture, message) => {
    await expect(
      executeWorkerDeploymentRollout(
        await options("start"),
        fixtureRunner(fixture, []),
      ),
    ).rejects.toThrow(message);
  });

  test("refuses out-of-order transitions and surfaces native CLI failures", async () => {
    await expect(
      executeWorkerDeploymentRollout(
        await options("advance"),
        fixtureRunner({}, []),
      ),
    ).rejects.toThrow("ramping version");

    await expect(
      executeWorkerDeploymentRollout(
        await options("status"),
        failingCommandRunner,
      ),
    ).rejects.toThrow("unavailable");
  });
});
