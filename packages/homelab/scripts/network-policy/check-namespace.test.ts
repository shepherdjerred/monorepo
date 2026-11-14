import { describe, expect, test } from "vitest";
import {
  parseCheckArguments,
  readEnforcerLog,
  readProbeSuccess,
  runCheck,
  type CheckDependencies,
} from "./check-namespace.ts";
import {
  breakGlassPolicy,
  fakeRunner,
  items,
  otherPolicy,
  probe,
  stagingPolicy,
} from "./fixtures.ts";

const daemonSet = (...containers: string[]) => ({
  stdout: JSON.stringify({
    spec: {
      selector: { matchLabels: { "k8s-app": "flannel", tier: "node" } },
      template: {
        spec: { containers: containers.map((name) => ({ name })) },
      },
    },
  }),
});

const readyPod = {
  metadata: { name: "app-0" },
  status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
};

function cluster(
  policies: unknown[],
  pods: unknown[] = [readyPod],
  probes: unknown[] = [],
) {
  return fakeRunner([
    ["get networkpolicies", items(...policies)],
    ["get probes", items(...probes)],
    ["get ingresses", items()],
    ["get daemonset kube-flannel", daemonSet("kube-flannel")],
    ["get namespace", { stdout: "{}" }],
    ["get pods", items(...pods)],
    ["get services", items()],
    ["get endpointslices", items()],
  ]);
}

function dependencies(run: CheckDependencies["run"]): CheckDependencies {
  return {
    run,
    fetchUrl: () => Promise.resolve({ status: 200, body: "" }),
    now: () => new Date("2026-11-13T12:00:00Z"),
  };
}

describe("arguments", () => {
  test("one namespace, with defaults", () => {
    expect(parseCheckArguments(["tracker"])).toEqual({
      target: { namespace: "tracker" },
      allowUnstaged: [],
      json: false,
      sinceMinutes: 10,
      expectStage: undefined,
      allowBreakGlass: false,
    });
  });

  test("flags", () => {
    expect(
      parseCheckArguments([
        "--all-staged",
        "--json",
        "--since-minutes",
        "30",
        "--expect-stage",
        "enforced",
        "--allow-break-glass",
      ]),
    ).toEqual({
      target: "all-staged",
      allowUnstaged: [],
      json: true,
      sinceMinutes: 30,
      expectStage: "enforced",
      allowBreakGlass: true,
    });
  });

  test("refuses no target, two targets and bad values", () => {
    for (const argv of [
      [],
      ["tracker", "--all-staged"],
      ["tracker", "media"],
      ["Tracker"],
      ["tracker", "--since-minutes", "0"],
      ["tracker", "--expect-stage", "closed"],
      ["tracker", "--apply"],
      ["tracker", "--coverage"],
      ["--all-staged", "--coverage"],
      ["tracker", "--allow-unstaged", "argocd"],
      ["--coverage", "--allow-unstaged", "Bad_Name"],
    ]) {
      expect(() => parseCheckArguments(argv)).toThrow();
    }
  });
});

function runningPods(...namespaces: string[]) {
  return items(
    ...namespaces.map((namespace) => ({
      metadata: { namespace },
      status: { phase: "Running" },
    })),
  );
}

describe("coverage", () => {
  test("arguments", () => {
    expect(
      parseCheckArguments([
        "--coverage",
        "--allow-unstaged",
        "argocd",
        "--allow-unstaged",
        "pg18-rehearsal-",
      ]),
    ).toMatchObject({
      target: "coverage",
      allowUnstaged: ["argocd", "pg18-rehearsal-"],
    });
  });

  test("fails on an unstaged namespace with pods, reading only policies and pods", async () => {
    const { run, calls } = fakeRunner([
      [
        "get networkpolicies",
        items(
          otherPolicy("argocd", "argocd-server"),
          otherPolicy("tracker", "tracker-app"),
          stagingPolicy("tracker", "open"),
        ),
      ],
      ["get pods --all-namespaces", runningPods("argocd", "tracker")],
    ]);
    const failing = await runCheck(
      parseCheckArguments(["--coverage"]),
      dependencies(run),
    );
    expect(failing.exitCode).toBe(1);
    expect(failing.output).toContain("FAIL (unstaged)");
    expect(failing.output).toContain("no usable staging policy: argocd");
    expect(calls.map(({ command }) => command.slice(0, 3).join(" "))).toEqual([
      "kubectl get networkpolicies.networking.k8s.io",
      "kubectl get pods",
    ]);
    const allowed = await runCheck(
      parseCheckArguments([
        "--coverage",
        "--allow-unstaged",
        "argocd",
        "--json",
      ]),
      dependencies(run),
    );
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.output)).toMatchObject({ ok: true });
  });
});

describe("optional sources", () => {
  test("a missing toolkit is not-checked with the reason", async () => {
    const { run } = fakeRunner([]);
    const success = await readProbeSuccess(run);
    expect(success).toEqual({
      available: false,
      reason: expect.stringContaining("toolkit prom query probe_success"),
    });
  });

  test("the enforcer log is not available until the sidecar exists", async () => {
    const { run, calls } = fakeRunner([
      ["get daemonset", daemonSet("kube-flannel")],
    ]);
    expect(await readEnforcerLog(run, 10)).toEqual({
      available: false,
      reason:
        "kube-flannel has no kube-network-policies container (enforcement is not switched on)",
    });
    expect(calls).toHaveLength(1);
  });

  test("the enforcer log is read from every node's pod", async () => {
    const { run, calls } = fakeRunner([
      ["get daemonset", daemonSet("kube-flannel", "kube-network-policies")],
      ["logs", { stdout: "line one\nline two" }],
    ]);
    expect(await readEnforcerLog(run, 15)).toEqual({
      available: true,
      lines: ["line one", "line two"],
      minutes: 15,
    });
    expect(calls[1]?.command.join(" ")).toBe(
      "kubectl --namespace kube-system logs --selector k8s-app=flannel,tier=node --container kube-network-policies --since=15m --tail=-1 --prefix",
    );
  });
});

describe("the gate", () => {
  test("reports one namespace and only ever reads", async () => {
    const { run, calls } = cluster(
      [stagingPolicy("tracker", "enforced")],
      [readyPod],
      [
        probe("probe-tracker", "http_2xx", "http://tracker.tracker:7351/", {
          namespace: "tracker",
        }),
      ],
    );
    const result = await runCheck(
      parseCheckArguments(["tracker", "--expect-stage", "enforced"]),
      dependencies(run),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("INFO         stage     enforced");
    expect(result.output).toContain("NOT CHECKED  probes");
    expect(result.output).toContain("Result: PASS (with unchecked)");
    for (const { command, stdin } of calls) {
      expect(stdin).toBeUndefined();
      expect(command.join(" ")).toMatch(
        /^(?:kubectl (?:--namespace \S+ )?(?:get|logs) |toolkit prom query )/u,
      );
    }
  });

  test("exits non-zero on a failed check and on a missing namespace", async () => {
    const unready = {
      ...readyPod,
      status: { ...readyPod.status, conditions: [] },
    };
    const failing = await runCheck(
      parseCheckArguments(["tracker", "--json"]),
      dependencies(cluster([], [unready]).run),
    );
    expect(failing.exitCode).toBe(1);
    expect(JSON.parse(failing.output)).toMatchObject({
      namespace: "tracker",
      stage: "none",
      ok: false,
    });
    const { run } = fakeRunner([
      ["get networkpolicies", items()],
      ["get probes", items()],
      ["get ingresses", items()],
      ["get daemonset", daemonSet("kube-flannel")],
    ]);
    await expect(
      runCheck(parseCheckArguments(["typo"]), dependencies(run)),
    ).rejects.toThrow("get namespace typo");
  });

  test("--all-staged covers every staged namespace in one table", async () => {
    const { run } = cluster([
      stagingPolicy("tracker", "enforced"),
      stagingPolicy("media", "open"),
    ]);
    const result = await runCheck(
      parseCheckArguments(["--all-staged"]),
      dependencies(run),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/^media\s+open\s+PASS/mu);
    expect(result.output).toMatch(/^tracker\s+enforced\s+PASS/mu);
    expect(result.output).toContain("2/2 namespaces pass");
  });

  test("a live break-glass policy fails the gate unless allowed", async () => {
    const policies = [
      stagingPolicy("tracker", "enforced"),
      breakGlassPolicy("tracker"),
    ];
    const forgotten = await runCheck(
      parseCheckArguments(["tracker"]),
      dependencies(cluster(policies).run),
    );
    expect(forgotten.exitCode).toBe(1);
    expect(forgotten.output).toContain(
      "FAIL         stage     open (break-glass); staging policy: enforced",
    );
    expect(forgotten.output).toContain("netpol:open tracker --close --apply");
    const allowed = await runCheck(
      parseCheckArguments(["tracker", "--allow-break-glass"]),
      dependencies(cluster(policies).run),
    );
    expect(allowed.exitCode).toBe(0);
    expect(allowed.output).toContain(
      "INFO         stage     open (break-glass); staging policy: enforced",
    );
  });

  test("--all-staged also checks an unstaged namespace with a break-glass policy", async () => {
    const result = await runCheck(
      parseCheckArguments(["--all-staged"]),
      dependencies(
        cluster([stagingPolicy("media", "open"), breakGlassPolicy("flipt")])
          .run,
      ),
    );
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/^flipt\s+open \(break-glass\)\s.*FAIL$/mu);
    expect(result.output).toMatch(/^media\s+open\s.*PASS/mu);
    expect(result.output).toContain("1/2 namespaces pass");
  });

  test("--all-staged with nothing staged is not a pass", async () => {
    const result = await runCheck(
      parseCheckArguments(["--all-staged"]),
      dependencies(cluster([]).run),
    );
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("nothing was checked");
  });
});
