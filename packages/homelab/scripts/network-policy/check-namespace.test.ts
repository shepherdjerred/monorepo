import { describe, expect, test } from "vitest";
import {
  parseCheckArguments,
  readProbeSuccess,
  runCheck,
  type CheckDependencies,
} from "./check-namespace.ts";
import {
  evaluationQueries,
  IDS_PER_QUERY,
  LOKI_MAX_LINES,
  readEnforcerLog,
} from "./enforcer-log.ts";
import {
  breakGlassPolicy,
  failedPod,
  fakeRunner,
  items,
  otherPolicy,
  probe,
  stagingPolicy,
} from "./fixtures.ts";
import { denialsFor } from "./namespace-denials.ts";

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

const NOW = new Date("2026-11-20T07:00:00Z");

type LokiValue = { timestamp: string; line: string } | [string, string];

/** A `toolkit loki query -o json` answer: one stream per agent pod. */
function loki(streams: Record<string, LokiValue[]>): { stdout: string } {
  return {
    stdout: JSON.stringify({
      status: "success",
      data: {
        resultType: "streams",
        result: Object.entries(streams).map(([pod, values]) => ({
          stream: { container: "kube-network-policies", pod },
          values,
        })),
      },
    }),
  };
}

const gcxError = {
  exitCode: 1,
  stdout: JSON.stringify({
    type: "gcx.error",
    error: {
      summary: "Invalid query",
      details: "Loki query failed (HTTP 400)\n\nquery timed out",
    },
  }),
};

const sidecar = daemonSet("kube-flannel", "kube-network-policies");
const evaluating = (id: number, source: string, destination: string) =>
  `I1120 06:59:00.0 1 logging.go:67] "Evaluating packet" id=${String(id)} direction="Ingress" srcPod="${source}" dstPod="${destination}" packet=<`;
const denied = (id: number) =>
  `I1120 06:59:00.1 1 engine.go:68] "Packet denied by ingress policy" id=${String(id)}`;

const readyPod = {
  metadata: { name: "app-0" },
  status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
};

type Replies = Parameters<typeof fakeRunner>[0];

/** `enforcer` replies come first, so they override the defaults. */
function cluster(
  policies: unknown[],
  pods: unknown[] = [readyPod],
  probes: unknown[] = [],
  enforcer: Replies = [],
) {
  return fakeRunner([
    ...enforcer,
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
    now: () => NOW,
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
});

describe("enforcer denials from Loki", () => {
  test("are not available until the sidecar exists", async () => {
    const { run, calls } = fakeRunner([
      ["get daemonset", daemonSet("kube-flannel")],
    ]);
    expect(await readEnforcerLog(run, 10, NOW)).toEqual({
      available: false,
      reason:
        "kube-flannel has no kube-network-policies container (enforcement is not switched on)",
    });
    expect(calls).toHaveLength(1);
  });

  test("pair each denial with its own agent's evaluation of the same id", async () => {
    // Both agents denied a packet with id 7; ids are per agent pod.
    const { run, calls } = fakeRunner([
      ["get daemonset", sidecar],
      [
        'pod="kube-flannel-a"',
        loki({
          "kube-flannel-a": [
            ["100", evaluating(7, "tracker/tracker-0", "flipt/flipt-0")],
          ],
        }),
      ],
      [
        'pod="kube-flannel-b"',
        loki({
          "kube-flannel-b": [
            {
              timestamp: "300",
              line: evaluating(7, "my-tracker/x", "media/plex-0"),
            },
          ],
        }),
      ],
      [
        "Packet denied",
        // Loki answers newest first.
        loki({
          "kube-flannel-b": [{ timestamp: "400", line: denied(7) }],
          "kube-flannel-a": [["200", denied(7)]],
        }),
      ],
    ]);
    const log = await readEnforcerLog(run, 10, NOW);
    expect(log).toEqual({
      available: true,
      lines: [
        `[kube-flannel-a] ${evaluating(7, "tracker/tracker-0", "flipt/flipt-0")}`,
        `[kube-flannel-a] ${denied(7)}`,
        `[kube-flannel-b] ${evaluating(7, "my-tracker/x", "media/plex-0")}`,
        `[kube-flannel-b] ${denied(7)}`,
      ],
      minutes: 10,
      limitReached: false,
    });
    const lines = log.available ? log.lines : [];
    expect(denialsFor("tracker", lines)).toHaveLength(1);
    expect(denialsFor("media", lines)).toEqual([
      `[kube-flannel-b] ${denied(7)} <- [kube-flannel-b] ${evaluating(7, "my-tracker/x", "media/plex-0")}`,
    ]);
    expect(denialsFor("my", lines)).toEqual([]);
    expect(calls.map(({ command }) => command)).toEqual([
      [
        "kubectl",
        "--namespace",
        "kube-system",
        "get",
        "daemonset",
        "kube-flannel",
        "-o",
        "json",
      ],
      [
        "toolkit",
        "loki",
        "query",
        '{namespace="kube-system", container="kube-network-policies"} |~ "Packet denied by (egress|ingress) policy"',
        "--from",
        "2026-11-20T06:50:00.000Z",
        "--to",
        "2026-11-20T07:00:00.000Z",
        "--limit",
        "5000",
        "-o",
        "json",
      ],
      ...["kube-flannel-b", "kube-flannel-a"].map((pod) => [
        "toolkit",
        "loki",
        "query",
        `{namespace="kube-system", container="kube-network-policies", pod="${pod}"} |= "Evaluating packet" |~ "id=(7)[^0-9]"`,
        "--from",
        "2026-11-20T06:49:50.000Z",
        "--to",
        "2026-11-20T07:00:00.000Z",
        "--limit",
        "5000",
        "-o",
        "json",
      ]),
    ]);
  });

  test("no denial reads no evaluation", async () => {
    const { run, calls } = fakeRunner([
      ["get daemonset", sidecar],
      ["Packet denied", loki({})],
    ]);
    expect(await readEnforcerLog(run, 10, NOW)).toEqual({
      available: true,
      lines: [],
      minutes: 10,
      limitReached: false,
    });
    expect(calls).toHaveLength(2);
  });

  test("a failed Loki read is not available with the reason, never zero", async () => {
    const deniedFails = fakeRunner([
      ["get daemonset", sidecar],
      ["Packet denied", gcxError],
    ]);
    expect(await readEnforcerLog(deniedFails.run, 10, NOW)).toEqual({
      available: false,
      reason:
        "toolkit loki query exited 1: Loki query failed (HTTP 400) query timed out",
    });
    const evaluationFails = fakeRunner([
      ["get daemonset", sidecar],
      ["Evaluating packet", gcxError],
      ["Packet denied", loki({ "kube-flannel-a": [["200", denied(7)]] })],
    ]);
    expect(await readEnforcerLog(evaluationFails.run, 10, NOW)).toMatchObject({
      available: false,
      reason: expect.stringContaining("query timed out"),
    });
    const garbled = fakeRunner([
      ["get daemonset", sidecar],
      ["Packet denied", { stdout: "not json" }],
    ]);
    expect(await readEnforcerLog(garbled.run, 10, NOW)).toEqual({
      available: false,
      reason: "unexpected Loki response",
    });
  });

  test("a full Loki answer marks the count as a lower bound", async () => {
    const { run } = fakeRunner([
      ["get daemonset", sidecar],
      ["Evaluating packet", loki({})],
      [
        "Packet denied",
        loki({
          "kube-flannel-a": Array.from(
            { length: LOKI_MAX_LINES },
            (_, index): LokiValue => [String(index), denied(7)],
          ),
        }),
      ],
    ]);
    expect(await readEnforcerLog(run, 10, NOW)).toMatchObject({
      available: true,
      limitReached: true,
    });
  });

  test("ids are batched per agent pod and deduplicated", () => {
    const entries = [
      ...Array.from({ length: IDS_PER_QUERY + 1 }, (_, id) => ({
        pod: "kube-flannel-a",
        timestamp: 1n,
        line: denied(id),
      })),
      { pod: "kube-flannel-b", timestamp: 1n, line: denied(3) },
      { pod: "kube-flannel-b", timestamp: 2n, line: denied(3) },
    ];
    const queries = evaluationQueries(entries);
    expect(queries).toHaveLength(3);
    expect(queries[1]).toContain(
      `pod="kube-flannel-a"} |= "Evaluating packet" |~ "id=(${String(IDS_PER_QUERY)})[^0-9]"`,
    );
    expect(queries[2]).toContain(`pod="kube-flannel-b"`);
    expect(queries[2]).toContain(`"id=(3)[^0-9]"`);
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
        /^(?:kubectl (?:--namespace \S+ )?get |toolkit (?:prom|loki) query )/u,
      );
    }
  });

  test("reports the namespace's denials from Loki as a note", async () => {
    const { run, calls } = cluster(
      [stagingPolicy("tracker", "enforced")],
      [readyPod],
      [],
      [
        ["get daemonset kube-flannel", sidecar],
        [
          "Evaluating packet",
          loki({
            "kube-flannel-z6rmb": [
              ["100", evaluating(9, "tracker/client", "media/server")],
            ],
          }),
        ],
        ["Packet denied", loki({ "kube-flannel-z6rmb": [["200", denied(9)]] })],
      ],
    );
    const result = await runCheck(
      parseCheckArguments(["tracker", "--since-minutes", "60"]),
      dependencies(run),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      "INFO         denials   1 denials involving this namespace in the last 60m",
    );
    expect(result.output).toContain(
      `    - [kube-flannel-z6rmb] ${denied(9)} <- [kube-flannel-z6rmb] ${evaluating(9, "tracker/client", "media/server")}`,
    );
    expect(calls.map(({ command }) => command.join(" "))).toContainEqual(
      expect.stringContaining("--from 2026-11-20T06:00:00.000Z"),
    );
  });

  test("an unreadable Loki leaves the denials not available, not zero", async () => {
    const { run } = cluster(
      [stagingPolicy("tracker", "enforced")],
      [readyPod],
      [],
      [
        ["get daemonset kube-flannel", sidecar],
        ["Packet denied", gcxError],
      ],
    );
    const result = await runCheck(
      parseCheckArguments(["tracker"]),
      dependencies(run),
    );
    expect(result.output).toContain(
      "INFO         denials   not available: toolkit loki query exited 1: Loki query failed (HTTP 400) query timed out",
    );
    expect(result.output).not.toContain("0 denials");
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

describe("what the gate does not count", () => {
  test("a namespace scaled to zero does not request its URLs", async () => {
    const requested: string[] = [];
    const badGateway = (url: string) => {
      requested.push(url);
      return Promise.resolve({ status: 502, body: "" });
    };
    const policies = [stagingPolicy("minecraft-shuxin", "open")];
    const finishedJob = { ...readyPod, status: { phase: "Succeeded" } };
    const scaledToZero = await runCheck(
      parseCheckArguments(["minecraft-shuxin"]),
      {
        ...dependencies(cluster(policies, [finishedJob]).run),
        fetchUrl: badGateway,
      },
    );
    expect(scaledToZero.exitCode).toBe(0);
    expect(scaledToZero.output).toMatch(
      /^INFO\s+urls\s+namespace runs no pods; 2 URLs not checked$/mu,
    );
    expect(requested).toEqual([]);

    const running = await runCheck(parseCheckArguments(["minecraft-shuxin"]), {
      ...dependencies(cluster(policies, [readyPod]).run),
      fetchUrl: badGateway,
    });
    expect(running.exitCode).toBe(1);
    expect(running.output).toMatch(/^FAIL\s+urls\s+0\/2 URLs/mu);
    expect(requested).toEqual(["https://shuxin-bluemap.sjer.red/"]);
  });

  test("an old Failed pod is noted; one that failed in the window fails the gate", async () => {
    const policies = [stagingPolicy("media", "open")];
    const stale = failedPod("plex-old", {
      created: "2026-11-19T10:00:00Z",
      transitioned: "2026-11-19T10:00:01Z",
      finished: null,
    });
    const passing = await runCheck(
      parseCheckArguments(["media"]),
      dependencies(cluster(policies, [readyPod, stale]).run),
    );
    expect(passing.exitCode).toBe(0);
    expect(passing.output).toContain(
      "    - plex-old: Failed at 2026-11-19T10:00:01.000Z, before the last 10m (not counted)",
    );

    const job = failedPod("backup-job", {
      created: "2026-11-20T05:00:00Z",
      finished: "2026-11-20T06:58:00Z",
    });
    const failing = await runCheck(
      parseCheckArguments(["media"]),
      dependencies(cluster(policies, [readyPod, stale, job]).run),
    );
    expect(failing.exitCode).toBe(1);
    expect(failing.output).toContain("    - backup-job: not Ready (Failed)");
  });
});
