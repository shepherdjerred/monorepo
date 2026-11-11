import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withWorkerCandidateCheckout } from "#lib/delivery/workers/worker-candidate-checkout.ts";
import { candidateSourceCommand } from "#lib/delivery/workers/worker-candidate-checkout.ts";
import { workerCandidateEnvironment } from "#lib/delivery/workers/worker-candidate-checkout.ts";
import { timedWorkerPhase } from "#lib/delivery/workers/worker-phase-timing.ts";
import { z } from "zod";
import {
  REPLAY_SELECTION_CONCURRENCY,
  registeredWorkerWorkflowTypes,
  selectWorkerReplayTargets,
  workerReplayRoute,
} from "#lib/delivery/workers/worker-replay-targets.ts";
import {
  resolveWorkerDeploymentRolloutTarget,
  restorationAwareTarget,
} from "./worker-deployment-target.ts";
import { temporalCommand } from "./worker-deployment-commands.ts";
import {
  requireAcceptedWorkerDeployment,
  requireHealthyWorkflowPoller,
} from "./worker-deployment-proofs.ts";

const sample = (value: string) => ({
  stdout: JSON.stringify({
    status: "success",
    data: { resultType: "vector", result: [{ value: [1, value] }] },
  }),
  stderr: "",
});
function clock() {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return vi.spyOn(Bun, "sleep").mockImplementation(async (duration) => {
    if (typeof duration !== "number")
      throw new TypeError("Expected fixed wait");
    now += duration;
  });
}
describe("fresh worker poller observations", () => {
  afterEach(() => vi.restoreAllMocks());
  const options = {
    namespace: "prod",
    deploymentName: "scout-prod-workflows",
    buildId: "a".repeat(40),
    taskQueue: "scout-prod",
  };
  test("requeries the same exact build after transient zero and requires a fresh positive sample", async () => {
    const wait = clock();
    const run = vi
      .fn()
      .mockResolvedValueOnce(sample("0"))
      .mockResolvedValueOnce(sample("0"))
      .mockResolvedValueOnce(sample("2"));
    await requireHealthyWorkflowPoller(options, run, "stable");
    expect(run).toHaveBeenCalledTimes(3);
    expect(
      new Set(run.mock.calls.map((args) => JSON.stringify(args))).size,
    ).toBe(1);
    expect(run.mock.calls[0]?.[0][3]).toContain(
      'worker_build_id="' + options.buildId + '"',
    );
    expect(wait.mock.calls).toEqual([[5000], [5000]]);
  });
  test("persistent zero still fails after the fixed observation deadline", async () => {
    const wait = clock();
    const run = vi.fn().mockResolvedValue(sample("0"));
    await expect(
      requireHealthyWorkflowPoller(options, run, "stable"),
    ).rejects.toThrow("stable build has no healthy Workflow pollers");
    expect(run).toHaveBeenCalledTimes(13);
    expect(wait).toHaveBeenCalledTimes(12);
    expect(Date.now()).toBe(60_000);
  });
  test("command, authorization, malformed and invalid metric responses fail immediately", async () => {
    const wait = clock();
    const denied = vi.fn().mockRejectedValue(new Error("HTTP 403"));
    await expect(
      requireHealthyWorkflowPoller(options, denied, "candidate"),
    ).rejects.toThrow("HTTP 403");
    expect(denied).toHaveBeenCalledTimes(1);
    for (const response of [
      { stdout: "invalid-json", stderr: "" },
      { stdout: '{"status":"error","error":"unauthorized"}', stderr: "" },
      sample("NaN"),
      sample("-1"),
    ]) {
      const run = vi.fn().mockResolvedValue(response);
      await expect(
        requireHealthyWorkflowPoller(options, run, "candidate"),
      ).rejects.toThrow();
      expect(run).toHaveBeenCalledTimes(1);
    }
    expect(wait).not.toHaveBeenCalled();
  });
  test("accepted prerequisite uses the same fresh observation after strict routing proof", async () => {
    const wait = clock();
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          name: options.deploymentName,
          routingConfig: {
            currentVersionBuildID: options.buildId,
            rampingVersionBuildID: "",
            rampingVersionPercentage: 0,
          },
        }),
        stderr: "",
      })
      .mockResolvedValueOnce(sample("0"))
      .mockResolvedValueOnce(sample("1"));
    await requireAcceptedWorkerDeployment(
      { ...options, address: "temporal.test:7233" },
      run,
    );
    expect(run).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledOnce();
  });
});

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

const executor = { root: "/workspace/source", revision: "e".repeat(40) };
const ok = (source: string) => (argv: readonly string[]) => ({
  stdout: argv[0] === "git" && argv[1] === "rev-parse" ? source : "",
  stderr: "",
});

describe("candidate child environment", () => {
  test("gives the actual child a fixed Linux identity without inheriting credentials", async () => {
    const environment = workerCandidateEnvironment("beta");
    expect(Object.keys(environment).sort()).toEqual(
      [
        "PATH",
        "HOME",
        "TMPDIR",
        "MISE_DATA_DIR",
        "MISE_LOCKED",
        "MISE_EXEC_AUTO_INSTALL",
        "USER",
        "TEMPORAL_ADDRESS",
        "TEMPORAL_NAMESPACE",
        "TEMPORAL_TLS",
      ].sort(),
    );
    const result = await candidateSourceCommand(
      [
        "bun",
        "-e",
        "console.log(JSON.stringify({user:process.env.USER,namespace:process.env.TEMPORAL_NAMESPACE,tls:process.env.TEMPORAL_TLS,locked:process.env.MISE_LOCKED}))",
      ],
      import.meta.dir,
      environment,
    );
    expect(JSON.parse(result.stdout)).toEqual({
      user: "delivery",
      namespace: "beta",
      tls: "false",
      locked: "1",
    });
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
      { sourceRevision: source, target: "scout-beta", executor },
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
          if (cwd !== executor.root) directory ||= cwd;
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
});

describe("replay target selection and candidate failures", () => {
  test("overlaps at most the bounded number of type lookups and keeps registration order", async () => {
    const types = Array.from(
      { length: 3 * REPLAY_SELECTION_CONCURRENCY },
      (_, index) => `type${String(index).padStart(2, "0")}`,
    );
    const runs = new Map(types.map((type) => [type, crypto.randomUUID()]));
    let inFlight = 0,
      peak = 0;
    const selection = await selectWorkerReplayTargets(
      types,
      ["monorepo-workflows"],
      async (query) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        const type = /WorkflowType = '(\w+)'/u.exec(query)?.[1] ?? "";
        const index = types.indexOf(type);
        // Later types answer first, so completion order differs from type order.
        await Bun.sleep(types.length - index);
        inFlight--;
        if (index % 5 === 0) return null;
        return {
          workflowId: `central-${type}`,
          runId: runs.get(type),
          type,
          taskQueue: "monorepo-workflows",
        };
      },
    );
    expect(peak).toBe(REPLAY_SELECTION_CONCURRENCY);
    const missing = types.filter((_, index) => index % 5 === 0);
    expect(selection).toEqual({
      targets: types
        .filter((type) => !missing.includes(type))
        .map((type) => ({
          workflowId: `central-${type}`,
          runId: runs.get(type),
        })),
      missingTypes: missing,
    });
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
    const logged: string[] = [];
    const log = (text: string) => logged.push(text);
    await expect(
      candidateSourceCommand(
        ["bun", "-e", "console.error('must-not-be-reported');process.exit(3)"],
        import.meta.dir,
        { PATH: Bun.env["PATH"] },
        log,
      ),
    ).rejects.toThrow("preparation; exit 3; signal null");
    try {
      await candidateSourceCommand(
        ["bun", "-e", "console.error('must-not-be-reported');process.exit(3)"],
        import.meta.dir,
        { PATH: Bun.env["PATH"] },
        log,
      );
    } catch (error) {
      expect(String(error)).not.toContain("must-not-be-reported");
    }
    expect(logged).toHaveLength(2);
  });
  test("candidate failure writes its stdout and stderr tail to the Job log", async () => {
    const logged: string[] = [];
    await expect(
      candidateSourceCommand(
        [
          "bun",
          "-e",
          "console.log('step one passed');console.error('expected 2 to be 3');process.exit(1)",
          "test:workflows",
        ],
        import.meta.dir,
        { PATH: Bun.env["PATH"] },
        (text) => logged.push(text),
      ),
    ).rejects.toThrow(
      "Exact candidate source preparation/replay/canary failed (workflow-unit-tests; exit 1; signal null)",
    );
    expect(logged).toHaveLength(1);
    const [text = ""] = logged;
    expect(
      text.startsWith(
        "----- candidate workflow-unit-tests failed (exit 1; signal null); full output of stdout+stderr -----\n",
      ),
    ).toBe(true);
    expect(text).toContain("step one passed\n");
    expect(text).toContain("expected 2 to be 3\n");
    expect(
      text.endsWith("----- end candidate workflow-unit-tests output -----\n"),
    ).toBe(true);
  });
  test("candidate failure log keeps only the bounded tail", async () => {
    const logged: string[] = [];
    await expect(
      candidateSourceCommand(
        [
          "bun",
          "-e",
          String.raw`process.stdout.write('HEAD'+'x'.repeat(200*1024));process.stderr.write('TAIL-MARKER\n');setTimeout(()=>process.exit(2),50)`,
        ],
        import.meta.dir,
        { PATH: Bun.env["PATH"] },
        (text) => logged.push(text),
      ),
    ).rejects.toThrow("preparation; exit 2; signal null");
    const [text = ""] = logged;
    expect(text).toContain(
      `last ${String(64 * 1024)} of ${String(200 * 1024 + 4 + 12)} bytes`,
    );
    expect(text).toContain("TAIL-MARKER\n");
    expect(text).not.toContain("HEAD");
    expect(text.length).toBeLessThan(64 * 1024 + 512);
  });
  test("candidate output shares one bound across stdout and stderr", async () => {
    const logged: string[] = [];
    await expect(
      candidateSourceCommand(
        [
          "bun",
          "-e",
          "process.stdout.write('o'.repeat(3*1024*1024));process.stderr.write('e'.repeat(2*1024*1024));setTimeout(()=>{},10000)",
        ],
        import.meta.dir,
        { PATH: Bun.env["PATH"] },
        (text) => logged.push(text),
      ),
    ).rejects.toThrow("Candidate proof output exceeded its bound");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("(output exceeded its bound)");
    expect(logged[0]?.length).toBeLessThan(64 * 1024 + 512);
  });
  test("candidate success logs nothing and returns stdout alone", async () => {
    const logged: string[] = [];
    const result = await candidateSourceCommand(
      ["bun", "-e", "console.log('ok');console.error('noise')"],
      import.meta.dir,
      { PATH: Bun.env["PATH"] },
      (text) => logged.push(text),
    );
    expect(result).toEqual({ stdout: "ok\n", stderr: "" });
    expect(logged).toEqual([]);
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
        { sourceRevision: source, target: "central", executor },
        async (candidate) => {
          await candidate(["bun", "run", "test:workflows"]);
          if (mode === "replay-failure") throw new Error("Replay failed");
          return "candidate-only";
        },
        {
          execute: async (argv, cwd) => {
            if (cwd !== executor.root) root ||= cwd;
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

describe("candidate checkout reuse", () => {
  test("reuses the prepared executor checkout when the candidate is the executor revision", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "executor-checkout-"));
    try {
      const source = "d".repeat(40);
      const calls: { argv: readonly string[]; cwd: string }[] = [];
      const respond = ok(source);
      const result = await withWorkerCandidateCheckout(
        {
          sourceRevision: source,
          target: "central",
          executor: { root, revision: source },
        },
        async (candidate) => {
          await candidate(["bun", "run", "test:workflows"]);
          return "reused";
        },
        {
          execute: async (argv, cwd) => {
            calls.push({ argv, cwd });
            return respond(argv);
          },
        },
      );
      expect(result).toBe("reused");
      // No second fetch, install or generate: the bootstrap already prepared it.
      for (const word of [
        "fetch",
        "worktree",
        "--frozen-lockfile",
        "generate",
        "trust",
      ])
        expect(calls.some(({ argv }) => argv.includes(word))).toBe(false);
      expect(
        calls
          .filter(({ argv }) => argv.includes("build"))
          .map(({ cwd }) => cwd),
      ).toEqual(
        ["home-assistant", "llm-models", "glitter-context"].map(
          (name) => `${root}/packages/${name}`,
        ),
      );
      expect(
        calls.find(({ argv }) => argv.includes("test:workflows"))?.cwd,
      ).toBe(`${root}/packages/temporal`);
      expect(calls.filter(({ argv }) => argv[1] === "status")).toHaveLength(2);
      // The executor's own checkout survives its candidate proof.
      const kept = await stat(root);
      expect(kept.isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("adds another revision as a blobless worktree of the executor object store", async () => {
    const source = "b".repeat(40);
    const calls: { argv: readonly string[]; cwd: string }[] = [];
    const respond = ok(source);
    let directory = "";
    await withWorkerCandidateCheckout(
      { sourceRevision: source, target: "central", executor },
      async (candidate) => {
        await candidate(["bun", "run", "test:workflows"]);
      },
      {
        execute: async (argv, cwd) => {
          if (cwd !== executor.root) directory ||= cwd;
          calls.push({ argv, cwd });
          return respond(argv);
        },
      },
    );
    expect(
      calls.filter(({ cwd }) => cwd === executor.root).map(({ argv }) => argv),
    ).toEqual([
      [
        "git",
        "config",
        "remote.origin.url",
        "https://github.com/shepherdjerred/monorepo.git",
      ],
      ["git", "config", "remote.origin.promisor", "true"],
      ["git", "config", "remote.origin.partialclonefilter", "blob:none"],
      [
        "git",
        "fetch",
        "--quiet",
        "--no-tags",
        "--depth=1",
        "--filter=blob:none",
        "origin",
        source,
      ],
      ["git", "worktree", "add", "--quiet", "--detach", directory, source],
      ["git", "worktree", "remove", "--force", directory],
    ]);
    expect(
      calls.find(({ argv }) => argv.includes("--frozen-lockfile"))?.cwd,
    ).toBe(directory);
    expect(calls.find(({ argv }) => argv.includes("test:workflows"))?.cwd).toBe(
      `${directory}/packages/temporal`,
    );
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
  test("logs each preparation and candidate command phase with its duration", async () => {
    const lines: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((line) => {
      lines.push(String(line));
    });
    try {
      const source = "b".repeat(40);
      await withWorkerCandidateCheckout(
        { sourceRevision: source, target: "central", executor },
        async (candidate) => {
          await candidate(["bun", "run", "test:workflows"]);
          await candidate(["bun", "run", "replay:candidate-histories"]);
          await candidate([
            "bun",
            "run",
            "scripts/rollout/worker-deployment-canary.ts",
            "--namespace",
            "beta",
          ]);
        },
        {
          execute: async (argv) => ok(source)(argv),
          replayArguments: async () => [
            "--run",
            "central-retained",
            crypto.randomUUID(),
          ],
        },
      );
    } finally {
      warn.mockRestore();
    }
    const phases = lines.map((line) =>
      z
        .object({
          kind: z.literal("worker-release-phase"),
          phase: z.string(),
          namespace: z.string().optional(),
          outcome: z.literal("passed"),
          durationMs: z.number().int().nonnegative(),
        })
        .parse(JSON.parse(line)),
    );
    expect(
      phases.map(({ phase, namespace }) =>
        namespace === undefined ? phase : `${phase}:${namespace}`,
      ),
    ).toEqual([
      "candidate-checkout",
      "candidate-install",
      "candidate-build",
      "workflow-unit-tests",
      "history-replay-selection",
      "history-replay",
      "canary:beta",
    ]);
  });
  test("a failed phase is logged as failed and rethrown unchanged", async () => {
    const lines: string[] = [];
    const failure = new Error("canary failed");
    await expect(
      timedWorkerPhase(
        "canary",
        { namespace: "prod" },
        () => Promise.reject(failure),
        (line) => lines.push(line),
      ),
    ).rejects.toBe(failure);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      kind: "worker-release-phase",
      phase: "canary",
      namespace: "prod",
      outcome: "failed",
    });
  });
  test("never auto-installs unrequested tools in candidate children", () => {
    expect(workerCandidateEnvironment("prod")).toMatchObject({
      MISE_LOCKED: "1",
      MISE_EXEC_AUTO_INSTALL: "false",
    });
  });
});

describe("restorationAwareTarget", () => {
  const prod = resolveWorkerDeploymentRolloutTarget(
    "scout-prod",
    "temporal.test:7233",
  );
  test("a new prod candidate keeps the beta acceptance prerequisite", () => {
    expect(restorationAwareTarget(prod, null)).toBe(prod);
    expect(prod.acceptancePrerequisite?.deploymentName).toBe(
      "scout-beta-workflows",
    );
  });
  /**
   * scout-for-lol/prod 6cc6379e (2026-11-08): the monitor's rollback to the
   * previously accepted build failed preflight because beta had moved on to the
   * alarmed release, so no Scout prod rollback could ever pass.
   */
  test("a restoration of an accepted build drops only the beta prerequisite", () => {
    const restored = restorationAwareTarget(prod, "deployment/accepted");
    expect(restored.acceptancePrerequisite).toBeUndefined();
    expect({
      ...restored,
      acceptancePrerequisite: prod.acceptancePrerequisite,
    }).toEqual(prod);
  });
});
