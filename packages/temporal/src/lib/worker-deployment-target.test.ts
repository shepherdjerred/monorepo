import { describe, expect, test } from "vitest";
import { stat } from "node:fs/promises";
import { withWorkerCandidateCheckout } from "#lib/delivery/workers/worker-candidate-checkout.ts";
import { candidateSourceCommand } from "#lib/delivery/workers/worker-candidate-checkout.ts";
import {
  registeredWorkerWorkflowTypes,
  selectWorkerReplayTargets,
  workerReplayRoute,
} from "#lib/delivery/workers/worker-replay-targets.ts";
import { resolveWorkerDeploymentRolloutTarget } from "./worker-deployment-target.ts";
import { temporalCommand } from "./worker-deployment-commands.ts";
import { requireAcceptedWorkerDeployment } from "./worker-deployment-proofs.ts";

describe("worker Temporal command boundary", () => {
  const address =
    "temporal-temporal-server-service.temporal.svc.cluster.local:7233";
  const args = [
    "worker",
    "deployment",
    "describe-version",
    "--build-id",
    "reviewed-build",
  ];
  test("uses native internal CLI with explicit transport and no ambient credential/profile configuration", () => {
    expect(temporalCommand({ address, namespace: "beta" }, args)).toEqual([
      "temporal",
      ...args,
      "--address",
      address,
      "--namespace",
      "beta",
      "--disable-config-env",
      "--disable-config-file",
      "--tls=false",
    ]);
    expect(() =>
      temporalCommand({ address, namespace: "beta", tls: true }, args),
    ).toThrow("requires plaintext");
  });
  test("retains the credential broker for external and near-match endpoints", () => {
    for (const external of [
      "temporal.tailnet-1a49.ts.net:443",
      `${address}.invalid`,
    ])
      expect(
        temporalCommand(
          { address: external, namespace: "prod", tls: true },
          args,
        ),
      ).toEqual([
        "toolkit",
        "temporal",
        ...args,
        "--address",
        external,
        "--namespace",
        "prod",
        "--tls",
      ]);
  });
  test("the production beta prerequisite uses the same internal native boundary", async () => {
    const buildId = "b".repeat(40);
    const commands: string[][] = [];
    await requireAcceptedWorkerDeployment(
      {
        address,
        namespace: "beta",
        buildId,
        deploymentName: "scout-beta-workflows",
        taskQueue: "scout-beta",
      },
      async (command) => {
        commands.push([...command]);
        if (command[0] === "temporal")
          return {
            stdout: JSON.stringify({
              name: "scout-beta-workflows",
              routingConfig: {
                currentVersionBuildID: buildId,
                rampingVersionBuildID: "",
                rampingVersionPercentage: 0,
              },
            }),
            stderr: "",
          };
        if (command[0] === "toolkit" && command[1] === "prom")
          return {
            stdout: JSON.stringify({
              status: "success",
              data: { resultType: "vector", result: [{ value: [0, "1"] }] },
            }),
            stderr: "",
          };
        throw new Error("Unexpected external credential bootstrap");
      },
    );
    expect(commands[0]).toEqual(
      temporalCommand({ address, namespace: "beta" }, [
        "worker",
        "deployment",
        "describe",
        "--name",
        "scout-beta-workflows",
        "--output",
        "json",
      ]),
    );
  });
});

describe("resolveWorkerDeploymentRolloutTarget", () => {
  test("maps the central target", () => {
    expect(
      resolveWorkerDeploymentRolloutTarget("central", "temporal:7233"),
    ).toMatchObject({
      deploymentName: "monorepo-central-workflows",
      taskQueue: "monorepo-workflows",
    });
  });

  test.each(["beta", "prod"] as const)("maps Scout %s", (stage) => {
    expect(
      resolveWorkerDeploymentRolloutTarget(`scout-${stage}`, "temporal:7233"),
    ).toMatchObject({
      deploymentName: `scout-${stage}-workflows`,
      taskQueue: `scout-${stage}`,
      candidatePinName: `shepherdjerred/scout-for-lol/${stage}/workflows/candidate`,
      stablePinName: `shepherdjerred/scout-for-lol/${stage}/workflows/stable`,
      canaryCommand: expect.arrayContaining([
        "--stage",
        stage,
        "--address",
        "temporal:7233",
      ]),
    });
  });

  test("requires Scout beta acceptance for the production target", () => {
    expect(
      resolveWorkerDeploymentRolloutTarget("scout-prod", "temporal:7233"),
    ).toMatchObject({
      acceptancePrerequisite: {
        namespace: "beta",
        deploymentName: "scout-beta-workflows",
        taskQueue: "scout-beta",
      },
    });
    expect(
      resolveWorkerDeploymentRolloutTarget("scout-beta", "temporal:7233"),
    ).not.toHaveProperty("acceptancePrerequisite");
  });

  test("rejects an unknown target", () => {
    expect(() =>
      resolveWorkerDeploymentRolloutTarget("scout-dev", "temporal:7233"),
    ).toThrow();
  });
});

describe("isolated immutable candidate source", () => {
  test("reads the real central and Scout registration entrypoints", async () => {
    const central = registeredWorkerWorkflowTypes(
      await Bun.file(new URL("../workflows/index.ts", import.meta.url)).text(),
    );
    const scout = registeredWorkerWorkflowTypes(
      await Bun.file(
        new URL(
          "../../../scout-for-lol/packages/temporal/src/workflows/index.ts",
          import.meta.url,
        ),
      ).text(),
    );
    expect(central).toContain("workerDeploymentCanaryWorkflow");
    expect(scout).toContain("scoutInteractiveRunWorkflow");
    expect(new Set(central).size).toBe(central.length);
    expect(new Set(scout).size).toBe(scout.length);
  });
  test("passes exact run pairs through the Scout cwd command while preserving the candidate checkout", async () => {
    const source = "b".repeat(40),
      runId = crypto.randomUUID();
    const calls: { argv: readonly string[]; cwd: string }[] = [];
    let directory = "";
    await withWorkerCandidateCheckout(
      source,
      "scout-beta",
      async (candidate) => {
        await candidate([
          "bun",
          "run",
          "--cwd",
          "../scout-for-lol/packages/temporal",
          "replay:candidate-histories",
          "--stage",
          "beta",
        ]);
      },
      {
        execute: async (argv, cwd) => {
          directory ||= cwd;
          calls.push({ argv, cwd });
          return {
            stdout: argv[0] === "git" && argv[1] === "rev-parse" ? source : "",
            stderr: "",
          };
        },
        replayArguments: async (root, target) => {
          expect(root).toBe(directory);
          expect(target).toBe("scout-beta");
          return ["--run", "scout-beta-retained", runId];
        },
      },
    );
    expect(
      calls.find((call) => call.argv.includes("replay:candidate-histories")),
    ).toEqual({
      cwd: `${directory}/packages/temporal`,
      argv: [
        "mise",
        "exec",
        "--",
        "bun",
        "run",
        "--cwd",
        "../scout-for-lol/packages/temporal",
        "replay:candidate-histories",
        "--stage",
        "beta",
        "--run",
        "scout-beta-retained",
        runId,
      ],
    });
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
  test("discovers actual runtime exports without evaluating Workflow code", () => {
    expect(
      registeredWorkerWorkflowTypes(
        "throw new Error('must not evaluate'); export function alpha() {} export const beta = () => {}; export type OnlyType = string;",
      ),
    ).toEqual(["alpha", "beta"]);
  });
  test("binds the candidate namespace and queues to its declared target", () => {
    expect(workerReplayRoute("scout-beta")).toMatchObject({
      namespace: "beta",
      taskQueues: ["scout-beta"],
    });
    expect(workerReplayRoute("scout-prod")).toMatchObject({
      namespace: "prod",
      taskQueues: ["scout-prod"],
    });
    expect(workerReplayRoute("central")).toMatchObject({
      namespace: "prod",
      taskQueues: expect.arrayContaining(["monorepo-workflows"]),
    });
  });
  test("freezes one exact open run per type, otherwise latest retained closed, and reports missing types", async () => {
    const openRun = crypto.randomUUID(),
      closedRun = crypto.randomUUID();
    const queries: string[] = [];
    const selection = await selectWorkerReplayTargets(
      ["alpha", "beta", "missing"],
      ["scout-beta"],
      async (query) => {
        queries.push(query);
        if (query.includes("'alpha'"))
          return {
            workflowId: "scout-beta-alpha",
            runId: openRun,
            type: "alpha",
            taskQueue: "scout-beta",
          };
        if (query.includes("'beta'") && query.includes("!= 'Running'"))
          return {
            workflowId: "scout-beta-beta",
            runId: closedRun,
            type: "beta",
            taskQueue: "scout-beta",
          };
        return null;
      },
    );
    expect(selection).toEqual({
      targets: [
        { workflowId: "scout-beta-alpha", runId: openRun },
        { workflowId: "scout-beta-beta", runId: closedRun },
      ],
      missingTypes: ["missing"],
    });
    expect(queries).toHaveLength(5);
    expect(
      queries.every((query) =>
        query.startsWith("TaskQueue IN ('scout-beta') AND WorkflowType = "),
      ),
    ).toBe(true);
    expect(queries.filter((query) => query.includes("'alpha'"))).toHaveLength(
      1,
    );
  });
  test.each([
    "empty",
    "foreign-type",
    "foreign-queue",
    "invalid-run",
    "duplicate-type",
  ])("refuses %s replay selection", async (mode) => {
    const execution = {
      workflowId: "scout-beta-alpha",
      runId: mode === "invalid-run" ? "wrong" : crypto.randomUUID(),
      type: mode === "foreign-type" ? "foreign" : "alpha",
      taskQueue: mode === "foreign-queue" ? "scout-prod" : "scout-beta",
    };
    await expect(
      selectWorkerReplayTargets(
        mode === "duplicate-type" ? ["alpha", "alpha"] : ["alpha"],
        ["scout-beta"],
        async () => (mode === "empty" ? null : execution),
      ),
    ).rejects.toThrow();
  });
  test("candidate failure reports only a fixed family and exit metadata", async () => {
    await expect(
      candidateSourceCommand(
        ["bun", "-e", "console.error('must-not-be-reported');process.exit(3)"],
        import.meta.dir,
        { PATH: Bun.env["PATH"] },
      ),
    ).rejects.toThrow("preparation; exit 3; signal null");
    try {
      await candidateSourceCommand(
        ["bun", "-e", "console.error('must-not-be-reported');process.exit(3)"],
        import.meta.dir,
        { PATH: Bun.env["PATH"] },
      );
    } catch (error) {
      expect(String(error)).not.toContain("must-not-be-reported");
    }
  });
});

describe("candidate checkout identity", () => {
  test.each(["valid", "wrong-sha", "dirty", "replay-failure"])(
    "checks and cleans %s candidate checkout",
    async (mode) => {
      const source = "b".repeat(40);
      const calls: { argv: readonly string[]; cwd: string }[] = [];
      let root = "";
      const proof = withWorkerCandidateCheckout(
        source,
        "central",
        async (candidate) => {
          await candidate(["bun", "run", "test:workflows"]);
          if (mode === "replay-failure") throw new Error("Replay failed");
          return "candidate-only";
        },
        {
          execute: async (argv, cwd) => {
            root ||= cwd;
            calls.push({ argv, cwd });
            return {
              stdout:
                argv[0] === "git" && argv[1] === "rev-parse"
                  ? mode === "wrong-sha"
                    ? "c".repeat(40)
                    : source
                  : mode === "dirty" &&
                      argv[0] === "git" &&
                      argv[1] === "status"
                    ? " M packages/temporal/src/workflows/index.ts"
                    : "",
              stderr: "",
            };
          },
        },
      );
      if (mode === "valid") await expect(proof).resolves.toBe("candidate-only");
      else await expect(proof).rejects.toThrow();
      await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        calls.some(
          ({ argv }) => argv.includes("fetch") && argv.at(-1) === source,
        ),
      ).toBe(true);
      if (mode === "wrong-sha" || mode === "dirty") {
        expect(calls.some(({ argv }) => argv[0] === "bun")).toBe(false);
      } else {
        expect(
          calls.some(({ argv }) => argv.includes("--frozen-lockfile")),
        ).toBe(true);
        expect(
          calls.find(({ argv }) => argv.includes("test:workflows"))?.cwd,
        ).toBe(`${root}/packages/temporal`);
      }
    },
  );
});
