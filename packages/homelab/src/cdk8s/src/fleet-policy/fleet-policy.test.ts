import { beforeAll, describe, expect, test } from "vitest";
import {
  againstDebt,
  loadFleet,
  selectorMatches,
  type Fleet,
} from "./fleet.ts";
import {
  containersAllowingPrivilegeEscalation,
  containersWithoutSeccomp,
  portContainersWithoutProbe,
  servedWorkloadsWithoutProbe,
  upstreamNamespacesWithoutPolicy,
  workloadsWithoutPolicy,
} from "./rules.ts";
import {
  blockedConfiguredConnections,
  configuredConnections,
} from "./configured-endpoints.ts";
import {
  apiServerRulesOffEndpoint,
  postgresClustersClosedToOperator,
} from "./platform-peers.ts";
import {
  egressPodsWithoutDns,
  tailscaleBackendsNotAdmitted,
} from "./platform-reachability.ts";
import { unreciprocatedRules } from "./policy-reciprocity.ts";
import { probePortsNotAdmitted } from "./probe-admission.ts";
import {
  CONTAINERS_ALLOWING_PRIVILEGE_ESCALATION,
  CONTAINERS_WITHOUT_SECCOMP,
  PORT_CONTAINERS_WITHOUT_PROBE,
  PROBE_PORTS_NOT_ADMITTED,
  SERVED_WORKLOADS_WITHOUT_PROBE,
  UNRECIPROCATED_EGRESS_RULES,
  UNRECIPROCATED_INGRESS_RULES,
  UPSTREAM_NAMESPACES_WITHOUT_EGRESS_POLICY,
  UPSTREAM_NAMESPACES_WITHOUT_INGRESS_POLICY,
  WORKLOADS_WITHOUT_EGRESS_POLICY,
  WORKLOADS_WITHOUT_INGRESS_POLICY,
} from "./debt-allowlists.ts";

/**
 * Fleet policy backstop over the synthesized manifests.
 *
 * Every rule holds for the whole fleet except the entries in
 * `debt-allowlists.ts`. Each rule is asserted in both directions: nothing
 * outside the allowlist may break it, and nothing inside the allowlist may
 * satisfy it. Fix a workload, then delete its entry.
 */

let fleet: Fleet;
beforeAll(async () => {
  fleet = await loadFleet();
});

/** For a rule that has never had an exception and must not gain one. */
const NO_DEBT: ReadonlySet<string> = new Set();

const RULES: readonly {
  name: string;
  violations: (fleet: Fleet) => string[];
  allowlist: ReadonlySet<string>;
}[] = [
  {
    name: "every workload is selected by an Ingress NetworkPolicy",
    violations: (current) => workloadsWithoutPolicy(current, "Ingress"),
    allowlist: WORKLOADS_WITHOUT_INGRESS_POLICY,
  },
  {
    name: "every workload is selected by an Egress NetworkPolicy",
    violations: (current) => workloadsWithoutPolicy(current, "Egress"),
    allowlist: WORKLOADS_WITHOUT_EGRESS_POLICY,
  },
  {
    name: "every upstream-chart namespace has an Ingress NetworkPolicy",
    violations: (current) =>
      upstreamNamespacesWithoutPolicy(current, "Ingress"),
    allowlist: UPSTREAM_NAMESPACES_WITHOUT_INGRESS_POLICY,
  },
  {
    name: "every upstream-chart namespace has an Egress NetworkPolicy",
    violations: (current) => upstreamNamespacesWithoutPolicy(current, "Egress"),
    allowlist: UPSTREAM_NAMESPACES_WITHOUT_EGRESS_POLICY,
  },
  {
    name: "every registered probe port admits blackbox-exporter and its ingress source",
    violations: probePortsNotAdmitted,
    allowlist: PROBE_PORTS_NOT_ADMITTED,
  },
  {
    name: "every cross-namespace Egress rule is admitted by its peer's Ingress policy",
    violations: (current) => unreciprocatedRules(current, "Egress"),
    allowlist: UNRECIPROCATED_EGRESS_RULES,
  },
  {
    name: "every cross-namespace Ingress rule is allowed by its peer's Egress policy",
    violations: (current) => unreciprocatedRules(current, "Ingress"),
    allowlist: UNRECIPROCATED_INGRESS_RULES,
  },
  {
    name: "every Service endpoint a workload's env configures is open in the policies on both ends",
    violations: blockedConfiguredConnections,
    allowlist: NO_DEBT,
  },
  {
    name: "every address rule for the API server names the endpoint it advertises",
    violations: apiServerRulesOffEndpoint,
    allowlist: NO_DEBT,
  },
  {
    name: "every policed PostgreSQL cluster admits the postgres-operator",
    violations: postgresClustersClosedToOperator,
    allowlist: NO_DEBT,
  },
  {
    name: "every policed Tailscale Ingress backend admits its proxy on the backend port",
    violations: tailscaleBackendsNotAdmitted,
    allowlist: NO_DEBT,
  },
  {
    name: "every pod an Egress policy selects can reach cluster DNS on 53 UDP and TCP",
    violations: egressPodsWithoutDns,
    allowlist: NO_DEBT,
  },
  {
    name: "every container that declares a port has a readiness or startup probe",
    violations: portContainersWithoutProbe,
    allowlist: PORT_CONTAINERS_WITHOUT_PROBE,
  },
  {
    name: "every workload behind a Service has a readiness or startup probe",
    violations: servedWorkloadsWithoutProbe,
    allowlist: SERVED_WORKLOADS_WITHOUT_PROBE,
  },
  {
    name: "every container forbids privilege escalation",
    violations: containersAllowingPrivilegeEscalation,
    allowlist: CONTAINERS_ALLOWING_PRIVILEGE_ESCALATION,
  },
  {
    name: "every container runs under a seccomp profile",
    violations: containersWithoutSeccomp,
    allowlist: CONTAINERS_WITHOUT_SECCOMP,
  },
];

describe("fleet policy", () => {
  test("synthesizes a meaningful fleet (sanity check)", () => {
    expect(fleet.workloads.length).toBeGreaterThan(50);
    expect(fleet.networkPolicies.length).toBeGreaterThan(50);
    expect(fleet.applicationNamespaces.size).toBeGreaterThan(50);
    expect(fleet.serviceSelectors.length).toBeGreaterThan(50);
    expect(fleet.backendProbes.length).toBeGreaterThan(40);
    expect(configuredConnections(fleet).length).toBeGreaterThan(100);
    expect(
      fleet.objects.filter(({ kind }) => kind === "Ingress").length,
    ).toBeGreaterThan(40);
    expect(
      fleet.networkPolicies.filter(({ policyTypes }) =>
        policyTypes.includes("Egress"),
      ).length,
    ).toBeGreaterThan(50);
    expect(
      fleet.objects.filter(({ kind }) => kind === "postgresql").length,
    ).toBeGreaterThan(5);
  });

  describe.each(RULES)("$name", ({ violations, allowlist }) => {
    test("holds outside the debt allowlist", () => {
      expect(againstDebt(violations(fleet), allowlist).unexpected).toEqual([]);
    });

    test("has no stale debt allowlist entry", () => {
      expect(againstDebt(violations(fleet), allowlist).stale).toEqual([]);
    });
  });
});

describe("againstDebt", () => {
  test("reports new violations and stale entries separately", () => {
    expect(againstDebt(["a", "b"], new Set(["b", "c"]))).toEqual({
      unexpected: ["a"],
      stale: ["c"],
    });
  });
});

function expression(key: string, operator: "Exists" | "DoesNotExist") {
  return { matchExpressions: [{ key, operator }] };
}

describe("selectorMatches", () => {
  const labels = { app: "sonarr", tier: "media" };

  test("an empty selector matches every pod", () => {
    expect(selectorMatches({}, labels)).toBe(true);
  });

  test("matchLabels requires every label", () => {
    expect(selectorMatches({ matchLabels: { app: "sonarr" } }, labels)).toBe(
      true,
    );
    expect(
      selectorMatches({ matchLabels: { app: "sonarr", tier: "home" } }, labels),
    ).toBe(false);
  });

  test.each([
    ["In", ["sonarr", "radarr"], true],
    ["In", ["radarr"], false],
    ["NotIn", ["radarr"], true],
    ["NotIn", ["sonarr"], false],
  ] as const)("matchExpressions %s %j", (operator, values, expected) => {
    expect(
      selectorMatches(
        { matchExpressions: [{ key: "app", operator, values: [...values] }] },
        labels,
      ),
    ).toBe(expected);
  });

  test("matchExpressions Exists and DoesNotExist", () => {
    expect(selectorMatches(expression("app", "Exists"), labels)).toBe(true);
    expect(selectorMatches(expression("missing", "Exists"), labels)).toBe(
      false,
    );
    expect(selectorMatches(expression("missing", "DoesNotExist"), labels)).toBe(
      true,
    );
    expect(selectorMatches(expression("app", "DoesNotExist"), labels)).toBe(
      false,
    );
  });

  test("NotIn matches a pod without the label", () => {
    expect(
      selectorMatches(
        {
          matchExpressions: [
            { key: "missing", operator: "NotIn", values: ["x"] },
          ],
        },
        labels,
      ),
    ).toBe(true);
  });
});
