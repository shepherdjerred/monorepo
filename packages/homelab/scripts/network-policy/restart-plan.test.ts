import { describe, expect, test } from "vitest";
import {
  breakGlassPolicy,
  fakeRunner,
  items,
  otherPolicy,
  stagingPolicy,
} from "./fixtures.ts";
import {
  parsePlanArguments,
  renderPlan,
  restartPlan,
  runPlan,
  selectorMatches,
  type ReplicaSet,
  type RestartPod,
} from "./restart-plan.ts";
import type { NetworkPolicy } from "./staging-policy.ts";

type PodOptions = {
  labels?: Record<string, string>;
  owner?: { kind: string; name: string };
  phase?: string;
  hostNetwork?: boolean;
};

function pod(
  namespace: string,
  name: string,
  options: PodOptions = {},
): RestartPod {
  return {
    metadata: {
      name,
      namespace,
      labels: options.labels ?? { app: name },
      ...(options.owner === undefined
        ? {}
        : { ownerReferences: [options.owner] }),
    },
    spec: options.hostNetwork === true ? { hostNetwork: true } : {},
    status: { phase: options.phase ?? "Running" },
  };
}

function replicaSet(
  namespace: string,
  name: string,
  deployment: string,
): ReplicaSet {
  return {
    metadata: {
      name,
      namespace,
      ownerReferences: [{ kind: "Deployment", name: deployment }],
    },
  };
}

function selecting(
  namespace: string,
  name: string,
  podSelector: NetworkPolicy["spec"]["podSelector"],
): NetworkPolicy {
  return { metadata: { name, namespace }, spec: { podSelector } };
}

const spilo = (cluster: string) => ({
  application: "spilo",
  "cluster-name": cluster,
});

const policies: NetworkPolicy[] = [
  selecting("temporal", "temporal-postgresql", {
    matchLabels: spilo("temporal-postgresql"),
  }),
  selecting("temporal", "temporal-workers", {
    matchExpressions: [
      { key: "component", operator: "In", values: ["server", "worker"] },
    ],
  }),
  stagingPolicy("temporal", "open"),
  selecting("media", "media-ingress", {
    matchExpressions: [
      { key: "media.sjer.red/application", operator: "DoesNotExist" },
      { key: "cluster-name", operator: "NotIn", values: ["other-postgresql"] },
    ],
  }),
  otherPolicy("tracker", "tracker"),
  // Allow-all policies isolate nothing, so their namespaces need no restart.
  stagingPolicy("redlib", "open"),
  breakGlassPolicy("flipt"),
  selecting("woodpecker-ci", "steps", {
    matchExpressions: [{ key: "ci.sjer.red/step-key", operator: "Exists" }],
  }),
  selecting("home", "everything", {}),
];

const replicaSets = [
  replicaSet(
    "temporal",
    "temporal-temporal-server-5d",
    "temporal-temporal-server",
  ),
  replicaSet(
    "temporal",
    "temporal-temporal-home-worker-7c",
    "temporal-temporal-home-worker",
  ),
  replicaSet("tracker", "tracker-6f", "tracker"),
  replicaSet("redlib", "redlib-1a", "redlib"),
  replicaSet("flipt", "flipt-2b", "flipt"),
  replicaSet("media", "sonarr-3c", "sonarr"),
];

const viaReplicaSet = (name: string) => ({ kind: "ReplicaSet", name });
const statefulSet = (name: string) => ({ kind: "StatefulSet", name });

const pods: RestartPod[] = [
  ...["x", "y"].map((suffix) =>
    pod("tracker", `tracker-6f-${suffix}`, {
      labels: { app: "tracker" },
      owner: viaReplicaSet("tracker-6f"),
    }),
  ),
  pod("tracker", "tracker-postgresql-0", {
    labels: spilo("tracker-postgresql"),
    owner: statefulSet("tracker-postgresql"),
  }),
  pod("temporal", "temporal-temporal-home-worker-7c-x", {
    labels: { component: "worker" },
    owner: viaReplicaSet("temporal-temporal-home-worker-7c"),
  }),
  pod("temporal", "temporal-temporal-server-5d-x", {
    labels: { component: "server" },
    owner: viaReplicaSet("temporal-temporal-server-5d"),
  }),
  pod("temporal", "temporal-temporal-ui-x", {
    labels: { component: "ui" },
    owner: viaReplicaSet("temporal-temporal-ui-9e"),
  }),
  pod("temporal", "temporal-postgresql-0", {
    labels: spilo("temporal-postgresql"),
    owner: statefulSet("temporal-postgresql"),
  }),
  pod("media", "media-postgresql-0", {
    labels: spilo("media-postgresql"),
    owner: statefulSet("media-postgresql"),
  }),
  pod("media", "sonarr-3c-x", { owner: viaReplicaSet("sonarr-3c") }),
  pod("media", "plex-0", {
    labels: { "media.sjer.red/application": "plex" },
    owner: statefulSet("plex"),
  }),
  pod("redlib", "redlib-1a-x", { owner: viaReplicaSet("redlib-1a") }),
  pod("flipt", "flipt-2b-x", { owner: viaReplicaSet("flipt-2b") }),
  pod("woodpecker-ci", "wp-step", {
    labels: { "ci.sjer.red/step-key": "lint" },
  }),
  pod("woodpecker-ci", "wp-done", {
    labels: { "ci.sjer.red/step-key": "lint" },
    phase: "Succeeded",
  }),
  pod("home", "homeassistant-0", {
    owner: statefulSet("homeassistant"),
    hostNetwork: true,
  }),
  pod("home", "zigbee-agent-x", {
    owner: { kind: "DaemonSet", name: "zigbee-agent" },
  }),
  pod("home", "backup-28-x", { owner: { kind: "Job", name: "backup-28" } }),
];

function summary(namespaces: string[] = []) {
  return restartPlan(policies, pods, replicaSets, namespaces).workloads.map(
    (entry) =>
      `${entry.tier} ${entry.namespace} ${entry.kind}/${entry.name} ${String(entry.pods)}`,
  );
}

describe("selector matching", () => {
  test("an empty selector selects every pod", () => {
    expect(selectorMatches({}, {})).toBe(true);
    expect(selectorMatches({}, { app: "x" })).toBe(true);
  });

  test("matchLabels and every expression must hold", () => {
    const selector = {
      matchLabels: { app: "x" },
      matchExpressions: [
        { key: "tier", operator: "In", values: ["web", "api"] },
        { key: "skip", operator: "DoesNotExist" },
        { key: "zone", operator: "NotIn", values: ["b"] },
        { key: "owner", operator: "Exists" },
      ],
    };
    const labels = { app: "x", tier: "web", owner: "me" };
    expect(selectorMatches(selector, labels)).toBe(true);
    expect(selectorMatches(selector, { ...labels, app: "y" })).toBe(false);
    expect(selectorMatches(selector, { ...labels, tier: "db" })).toBe(false);
    expect(selectorMatches(selector, { ...labels, skip: "1" })).toBe(false);
    expect(selectorMatches(selector, { ...labels, zone: "b" })).toBe(false);
    expect(selectorMatches(selector, { app: "x", tier: "web" })).toBe(false);
  });

  test("an unknown operator is an error, not a silent match", () => {
    expect(() =>
      selectorMatches(
        { matchExpressions: [{ key: "a", operator: "Gt", values: ["1"] }] },
        {},
      ),
    ).toThrow();
  });
});

describe("restart plan", () => {
  test("orders PostgreSQL clusters, then Temporal with its server first, then the rest", () => {
    expect(summary()).toEqual([
      "postgresql media StatefulSet/media-postgresql 1",
      "postgresql temporal StatefulSet/temporal-postgresql 1",
      "temporal temporal Deployment/temporal-temporal-server 1",
      "temporal temporal Deployment/temporal-temporal-home-worker 1",
      "other home DaemonSet/zigbee-agent 1",
      "other media Deployment/sonarr 1",
      "other tracker Deployment/tracker 2",
    ]);
  });

  test("leaves out pods no isolating policy selects", () => {
    const names = summary().join("\n");
    // Its namespace has a policy, but the policy selects another label.
    expect(names).not.toContain("tracker-postgresql");
    expect(names).not.toContain("temporal-temporal-ui");
    // DoesNotExist excludes it.
    expect(names).not.toContain("plex");
    // Only a staging or a break-glass policy selects these.
    expect(names).not.toContain("redlib");
    expect(names).not.toContain("flipt");
    // Policies do not apply to a host-network pod.
    expect(names).not.toContain("homeassistant");
  });

  test("reports selected pods that no rollout owns, and skips finished pods", () => {
    expect(restartPlan(policies, pods, replicaSets).unmanaged).toEqual([
      { namespace: "home", name: "backup-28-x", owner: "Job/backup-28" },
      { namespace: "woodpecker-ci", name: "wp-step", owner: "none" },
    ]);
  });

  test("a pod whose ReplicaSet is gone is reported, not guessed", () => {
    const orphan = pod("tracker", "tracker-old-x", {
      labels: { app: "tracker" },
      owner: viaReplicaSet("tracker-old"),
    });
    expect(restartPlan(policies, [orphan], replicaSets)).toEqual({
      workloads: [],
      unmanaged: [
        {
          namespace: "tracker",
          name: "tracker-old-x",
          owner: "ReplicaSet/tracker-old",
        },
      ],
    });
  });

  test("--namespace narrows the plan", () => {
    expect(summary(["tracker", "media"])).toEqual([
      "postgresql media StatefulSet/media-postgresql 1",
      "other media Deployment/sonarr 1",
      "other tracker Deployment/tracker 2",
    ]);
  });
});

describe("rendering", () => {
  test("prints restart and wait commands in order, and runs none of them", () => {
    const output = renderPlan(restartPlan(policies, pods, replicaSets));
    expect(output.split("\n")).toEqual([
      "# Restart plan: 7 workloads in 4 namespaces have pods a NetworkPolicy selects.",
      "# Nothing was run. Run the commands in this order, one workload at a time.",
      "",
      "# 1. PostgreSQL clusters (2)",
      "kubectl -n media rollout restart statefulset/media-postgresql",
      "kubectl -n media rollout status statefulset/media-postgresql --timeout=10m",
      "kubectl -n temporal rollout restart statefulset/temporal-postgresql",
      "kubectl -n temporal rollout status statefulset/temporal-postgresql --timeout=10m",
      "",
      "# 2. Temporal (2)",
      "kubectl -n temporal rollout restart deployment/temporal-temporal-server",
      "kubectl -n temporal rollout status deployment/temporal-temporal-server --timeout=10m",
      "kubectl -n temporal rollout restart deployment/temporal-temporal-home-worker",
      "kubectl -n temporal rollout status deployment/temporal-temporal-home-worker --timeout=10m",
      "",
      "# 3. Everything else (3)",
      "kubectl -n home rollout restart daemonset/zigbee-agent",
      "kubectl -n home rollout status daemonset/zigbee-agent --timeout=10m",
      "kubectl -n media rollout restart deployment/sonarr",
      "kubectl -n media rollout status deployment/sonarr --timeout=10m",
      "kubectl -n tracker rollout restart deployment/tracker",
      "kubectl -n tracker rollout status deployment/tracker --timeout=10m",
      "",
      "# Not restarted: 2 selected pods no rollout owns. They keep their old connections until they end.",
      "#   home/backup-28-x (owner: Job/backup-28)",
      "#   woodpecker-ci/wp-step (owner: none)",
    ]);
  });

  test("an empty plan still prints every heading", () => {
    expect(renderPlan({ workloads: [], unmanaged: [] })).toContain(
      "# 1. PostgreSQL clusters (0)",
    );
  });
});

describe("command", () => {
  test("parses its arguments and rejects the rest", () => {
    expect(parsePlanArguments([])).toEqual({ json: false, namespaces: [] });
    expect(
      parsePlanArguments([
        "--json",
        "--namespace",
        "media",
        "--namespace",
        "home",
      ]),
    ).toEqual({ json: true, namespaces: ["media", "home"] });
    expect(() => parsePlanArguments(["--namespace"])).toThrow(
      /namespace name/u,
    );
    expect(() => parsePlanArguments(["--namespace", "Bad_Name"])).toThrow();
    expect(() => parsePlanArguments(["--apply"])).toThrow(/Unknown argument/u);
  });

  test("only reads: three kubectl get calls and no other command", async () => {
    const { run, calls } = fakeRunner([
      ["get networkpolicies", items(...policies)],
      ["get pods", items(...pods)],
      ["get replicasets", items(...replicaSets)],
    ]);
    const output = await runPlan({ json: false, namespaces: ["tracker"] }, run);
    expect(output).toContain(
      "kubectl -n tracker rollout restart deployment/tracker",
    );
    expect(calls.map((call) => call.command.slice(0, 3).join(" "))).toEqual([
      "kubectl get networkpolicies.networking.k8s.io",
      "kubectl get pods",
      "kubectl get replicasets",
    ]);
    expect(calls.every((call) => call.stdin === undefined)).toBe(true);
  });

  test("--json prints the plan as data", async () => {
    const { run } = fakeRunner([
      ["get networkpolicies", items(...policies)],
      ["get pods", items(...pods)],
      ["get replicasets", items(...replicaSets)],
    ]);
    const plan = JSON.parse(
      await runPlan({ json: true, namespaces: ["tracker"] }, run),
    ) as unknown;
    expect(plan).toEqual({
      workloads: [
        {
          namespace: "tracker",
          kind: "Deployment",
          name: "tracker",
          tier: "other",
          pods: 2,
        },
      ],
      unmanaged: [],
    });
  });

  test("a failed read throws instead of printing a partial plan", async () => {
    const { run } = fakeRunner([["get networkpolicies", items(...policies)]]);
    await expect(runPlan({ json: false, namespaces: [] }, run)).rejects.toThrow(
      /exited 1/u,
    );
  });
});
