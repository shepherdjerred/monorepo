import { describe, expect, test, vi } from "vitest";
import { stringify } from "yaml";
import { parseMachineConfig, type TalosRunner } from "./machine-config.ts";
import {
  operatePromotionSandbox as realOperate,
  parseOperatorArgs,
  readNativeNodeInfo,
  TARGET,
  type OperatorOptions,
} from "./promotion-sandbox.ts";

const nodeInfo = {
  metadata: { name: "torvalds" },
  status: {
    nodeInfo: {
      architecture: "amd64",
      operatingSystem: "linux",
      containerRuntimeVersion: "containerd://2.3.6",
      osImage: "Talos (v1.14.2)",
      kernelVersion: "6.18.54-talos",
    },
  },
};
function operatePromotionSandbox(
  options: OperatorOptions,
  runner: TalosRunner,
) {
  return realOperate(options, runner, () =>
    Promise.resolve(JSON.stringify(nodeInfo)),
  );
}

const SECRET = "synthetic-secret-never-print";
const current =
  stringify({
    version: "v1alpha1",
    machine: {
      sysctls: {
        "user.max_user_namespaces": "0",
        "vm.max_map_count": "262144",
      },
      token: SECRET,
    },
    cluster: { secret: SECRET },
  }) +
  "---\n" +
  stringify({
    apiVersion: "v1alpha1",
    kind: "UnrelatedDocument",
    secret: SECRET,
  });

function profileFromConfig(candidate: string) {
  const doc = parseMachineConfig(candidate).find(
    (entry) => entry["version"] === "v1alpha1",
  );
  const machine = doc?.["machine"];
  if (
    typeof machine !== "object" ||
    machine === null ||
    !("seccompProfiles" in machine)
  )
    throw new TypeError("fixture missing profiles");
  const profiles: unknown = machine.seccompProfiles;
  if (!Array.isArray(profiles)) throw new TypeError("fixture invalid profiles");
  const first: unknown = profiles[0];
  if (typeof first !== "object" || first === null || !("value" in first))
    throw new TypeError("fixture missing profile");
  return JSON.stringify(first.value, null, 2) + "\n";
}

function fixture(
  options: {
    staleVersion?: boolean;
    staleBytes?: boolean;
    applyFailure?: boolean;
    readbackDrift?: boolean;
    quota?: string;
    profile?: string;
    healthFailure?: boolean;
    runtime?: string;
    persistentDrift?: boolean;
    postPersistentDrift?: boolean;
    stalePersistentVersion?: boolean;
    config?: string;
  } = {},
) {
  const calls: { args: readonly string[]; input?: string }[] = [];
  let reads = 0;
  let applied = false;
  let candidate = "";
  function getConfig(id: string | undefined) {
    reads += 1;
    let spec = options.config ?? current;
    if (applied) {
      // Serialization and mapping key order are deliberately different.
      spec = parseMachineConfig(candidate)
        .map((doc) =>
          stringify(Object.fromEntries(Object.entries(doc).reverse())),
        )
        .join("---\n");
      if (options.readbackDrift) spec += "---\nkind: ConcurrentDocument\n";
    } else if (reads === 3 && options.staleBytes)
      spec += "\n# concurrent edit\n";
    if (id === "persistent" && options.persistentDrift)
      spec += "---\nkind: StagedChange\n";
    if (applied && id === "persistent" && options.postPersistentDrift)
      spec += "---\nkind: PostApplyPersistentDrift\n";
    const changedVersion =
      (reads === 3 && options.staleVersion === true) ||
      (reads === 4 && options.stalePersistentVersion === true);
    return JSON.stringify({
      node: TARGET,
      metadata: { version: changedVersion ? 2 : applied ? 2 : 1 },
      spec,
    });
  }
  const runner: TalosRunner = async (args, input) => {
    calls.push({ args, ...(input === undefined ? {} : { input }) });
    if (args[0] === "version")
      return (
        options.runtime ??
        JSON.stringify({
          version: { tag: "v1.14.2", os: "linux", arch: "amd64" },
          platform: { name: "metal", mode: "metal" },
        })
      );
    if (args[0] === "get") return getConfig(args[2]);
    if (args[0] === "validate") {
      candidate = input ?? "";
      return "";
    }
    if (args[0] === "apply-config") {
      applied = true;
      if (options.applyFailure)
        throw new Error(`private native diff ${SECRET}`);
      expect(input).toBe(candidate);
      return "private successful diff must also be withheld";
    }
    if (args[0] === "read") {
      return args[1] === "/proc/sys/user/max_user_namespaces"
        ? (options.quota ?? "128\n")
        : (options.profile ?? profileFromConfig(candidate));
    }
    if (args[0] === "health") {
      if (options.healthFailure) throw new Error(SECRET);
      return "healthy";
    }
    throw new Error("Unexpected native command");
  };
  return { runner, calls };
}

describe("promotion operator native command boundary", () => {
  test("default node reader resolves native kubectl and captures the bounded authenticated command", async () => {
    const which = vi
      .spyOn(Bun, "which")
      .mockReturnValue("/trusted/bin/kubectl");
    const spawn = vi.spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error(
        "synthetic spawn boundary stopped before any native command",
      );
    });
    try {
      await expect(readNativeNodeInfo()).rejects.toThrow(
        "synthetic spawn boundary",
      );
      expect(which).toHaveBeenCalledWith("kubectl", {
        cwd: "/",
        PATH: expect.any(String),
      });
      expect(spawn.mock.calls[0]?.[0]).toEqual([
        "/trusted/bin/kubectl",
        "get",
        "node",
        "torvalds",
        "--output=json",
      ]);
      const options = spawn.mock.calls[0]?.[1];
      expect(options?.stdin).toBe("ignore");
      expect(options?.stdout).toBe("pipe");
      expect(options?.stderr).toBe("pipe");
    } finally {
      spawn.mockRestore();
      which.mockRestore();
    }
  });

  test("missing native kubectl fails before spawning any command", async () => {
    const which = vi.spyOn(Bun, "which").mockReturnValue(null);
    const spawn = vi.spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("must never spawn");
    });
    try {
      await expect(readNativeNodeInfo()).rejects.toThrow(
        "native kubectl tooling: required executable not found",
      );
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      spawn.mockRestore();
      which.mockRestore();
    }
  });
});

describe("promotion operator reviewed plan and apply", () => {
  test("plan validates full credential-bearing bytes but exports only safe evidence", async () => {
    const { runner, calls } = fixture();
    const plan = await operatePromotionSandbox({}, runner);
    expect(plan.status).toBe("planned");
    expect(plan.planSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(plan)).not.toContain(SECRET);
    expect(calls.map((call) => call.args[0])).toEqual([
      "version",
      "get",
      "get",
      "validate",
    ]);
    expect(calls[3]?.input).toContain(SECRET);
    expect(calls.flatMap((call) => call.args).join(" ")).not.toContain(SECRET);
  });

  test("apply binds the plan, reads fresh state, uses stdin no-reboot and verifies semantics/runtime/health", async () => {
    const plan = await operatePromotionSandbox({}, fixture().runner);
    const { runner, calls } = fixture();
    const result = await operatePromotionSandbox(
      { applyPlanSha256: plan.planSha256 },
      runner,
    );
    expect(result.status).toBe("applied-and-verified");
    expect(result).toMatchObject({
      configSemanticEquality: true,
      observedQuota: "128",
      talosHealth: "passed",
    });
    expect(calls.map((call) => call.args[0])).toEqual([
      "version",
      "get",
      "get",
      "validate",
      "version",
      "get",
      "get",
      "apply-config",
      "get",
      "get",
      "read",
      "read",
      "health",
    ]);
    const apply = calls.find((call) => call.args[0] === "apply-config");
    expect(apply?.args).toEqual([
      "apply-config",
      "--file",
      "/dev/stdin",
      "--mode=no-reboot",
      "--nodes",
      TARGET,
      "--endpoints",
      TARGET,
    ]);
    expect(apply?.input).toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    for (const call of calls.filter((entry) => entry.args[0] !== "validate"))
      expect(call.args).toContain(TARGET);
  });

  test("rejects an unreviewed digest before even preflighting or applying", async () => {
    const { runner, calls } = fixture();
    await expect(
      operatePromotionSandbox({ applyPlanSha256: "0".repeat(64) }, runner),
    ).rejects.toThrow("reviewed plan");
    expect(calls.map((call) => call.args[0])).toEqual([
      "version",
      "get",
      "get",
      "validate",
    ]);
  });
});

describe("promotion operator concurrency and runtime guards", () => {
  test.each([
    { staleVersion: true },
    { staleBytes: true },
    { stalePersistentVersion: true },
  ])("refuses concurrent state change %j without writing", async (option) => {
    const plan = await operatePromotionSandbox({}, fixture().runner);
    const { runner, calls } = fixture(option);
    await expect(
      operatePromotionSandbox({ applyPlanSha256: plan.planSha256 }, runner),
    ).rejects.toThrow("concurrent configuration change");
    expect(
      calls.filter((call) => call.args[0] === "apply-config"),
    ).toHaveLength(0);
  });

  test("refuses differing active and persistent config before preparing a write", async () => {
    const { runner, calls } = fixture({ persistentDrift: true });
    await expect(operatePromotionSandbox({}, runner)).rejects.toThrow(
      "active/persistent preflight",
    );
    expect(calls.map((call) => call.args[0])).toEqual([
      "version",
      "get",
      "get",
    ]);
  });

  test("rejects mismatched live containerd pins via the independent node boundary", async () => {
    const { runner, calls } = fixture();
    const wrong = structuredClone(nodeInfo);
    wrong.status.nodeInfo.containerRuntimeVersion = "containerd://2.4.0";
    await expect(
      realOperate({}, runner, () => Promise.resolve(JSON.stringify(wrong))),
    ).rejects.toThrow("live containerd version and node architecture");
    expect(calls.some((call) => call.args[0] === "apply-config")).toBe(false);
  });

  test("rechecks the independent runtime boundary before submission", async () => {
    const plan = await operatePromotionSandbox({}, fixture().runner);
    const { runner, calls } = fixture();
    let reads = 0;
    const changed = structuredClone(nodeInfo);
    changed.status.nodeInfo.containerRuntimeVersion = "containerd://2.4.0";
    await expect(
      realOperate({ applyPlanSha256: plan.planSha256 }, runner, () =>
        Promise.resolve(JSON.stringify(++reads === 1 ? nodeInfo : changed)),
      ),
    ).rejects.toThrow("fresh containerd runtime preflight");
    expect(calls.some((call) => call.args[0] === "apply-config")).toBe(false);
  });
});

describe("promotion operator failure handling and verification", () => {
  test.each([
    [{ applyFailure: true }, "apply outcome unknown"],
    [{ readbackDrift: true }, "post-apply semantic comparison"],
    [{ postPersistentDrift: true }, "post-apply active/persistent comparison"],
    [{ quota: "0" }, "runtime namespace quota"],
    [{ profile: '{"wrong":true}' }, "installed profile comparison"],
    [{ profile: SECRET }, "installed profile parsing"],
    [{ healthFailure: true }, "post-apply node health"],
  ] as const)(
    "stops at the failing layer %j without retry or rollback",
    async (option, layer) => {
      const plan = await operatePromotionSandbox({}, fixture().runner);
      const { runner, calls } = fixture(option);
      let failure: unknown;
      try {
        await operatePromotionSandbox(
          { applyPlanSha256: plan.planSha256 },
          runner,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toContain(layer);
      expect(String(failure)).not.toContain(SECRET);
      expect(
        calls.filter((call) => call.args[0] === "apply-config"),
      ).toHaveLength(1);
    },
  );

  test("malformed resource and native validation errors never expose private material", async () => {
    for (const readRunner of [
      async () => `malformed ${SECRET}`,
      async () =>
        JSON.stringify({
          node: "liskov",
          metadata: { version: 1 },
          spec: current,
        }),
      async () => {
        throw new Error(SECRET);
      },
    ]) {
      const runner: TalosRunner = (args, input) =>
        args[0] === "version" ? fixture().runner(args, input) : readRunner();
      await expect(operatePromotionSandbox({}, runner)).rejects.toThrow(
        "read configuration: operation failed; native output withheld",
      );
    }
    await expect(
      operatePromotionSandbox(
        {},
        fixture({ config: current.replace('"0"', '"999"') }).runner,
      ),
    ).rejects.toThrow("source policy and native full-config validation");
  });

  test("already configured plans verify installed policy and health without resubmitting configuration", async () => {
    const initial = fixture();
    await operatePromotionSandbox({}, initial.runner);
    const candidate = initial.calls.find(
      (call) => call.args[0] === "validate",
    )?.input;
    if (candidate === undefined) throw new Error("Missing fixture candidate");
    const plan = await operatePromotionSandbox(
      {},
      fixture({ config: candidate }).runner,
    );
    const { runner, calls } = fixture({ config: candidate });
    const result = await operatePromotionSandbox(
      { applyPlanSha256: plan.planSha256 },
      runner,
    );
    expect(result.status).toBe("already-configured-and-verified");
    expect(
      calls.filter((call) => call.args[0] === "apply-config"),
    ).toHaveLength(0);
    expect(calls.at(-1)?.args[0]).toBe("health");
  });

  test.each(["v1.14.1", "arm64"])(
    "rejects a different runtime pin %s before reading machine configuration",
    async (different) => {
      const runtime = JSON.stringify({
        version: {
          tag: different.startsWith("v") ? different : "v1.14.2",
          os: "linux",
          arch: different === "arm64" ? different : "amd64",
        },
        platform: { name: "metal", mode: "metal" },
      });
      const { runner, calls } = fixture({ runtime });
      await expect(operatePromotionSandbox({}, runner)).rejects.toThrow(
        "live Talos version and architecture",
      );
      expect(calls.map((call) => call.args[0])).toEqual(["version"]);
    },
  );

  test("only no arguments or an explicit reviewed apply digest are accepted", () => {
    expect(parseOperatorArgs([])).toEqual({});
    expect(parseOperatorArgs(["--apply", "a".repeat(64)])).toEqual({
      applyPlanSha256: "a".repeat(64),
    });
    for (const args of [
      ["--apply"],
      ["--target", "liskov"],
      ["--apply", "bad"],
      ["--rollback"],
    ]) {
      expect(() => parseOperatorArgs(args)).toThrow("arguments");
    }
  });
});
