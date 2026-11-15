import { describe, expect, test } from "vitest";
import {
  DENIED_PACKETS_BY_NODE,
  DENY_ALL_MATCHES_BY_POLICY,
  exportNetworkPolicyEnforcementDashboardJson,
} from "./network-policy-enforcement-dashboard.ts";

// klog text lines as kube-network-policies v1.1.2 writes them at --v=2:
// pkg/networkpolicy/engine.go (denials, contextual `id`) and
// pkg/networkpolicy/networkpolicy.go (`klog.KObj` renders as "ns/name").
const DENIED =
  'I1115 04:15:39.949780       1 engine.go:57] "Packet denied by egress policy" id=4211';
const DENY_ALL =
  'I1115 04:15:39.949700       1 networkpolicy.go:302] "Pod has limited all ingress traffic" id=4212 pod="tracker/tracker-0" policy="tracker/tracker-default-deny"';

/** The LogQL `regexp` stage's RE2 pattern, in JavaScript syntax. */
function regexpStage(logql: string): RegExp {
  const match = /\| regexp `([^`]+)`/.exec(logql);
  if (match?.[1] === undefined) throw new Error("no regexp stage");
  return new RegExp(match[1].replaceAll("(?P<", "(?<"));
}

describe("network policy enforcement dashboard", () => {
  test("parses the v1.1.2 denial line", () => {
    expect(regexpStage(DENIED_PACKETS_BY_NODE).exec(DENIED)?.groups).toEqual({
      direction: "egress",
    });
  });

  test("parses the namespace and policy of a deny-all match", () => {
    expect(
      regexpStage(DENY_ALL_MATCHES_BY_POLICY).exec(DENY_ALL)?.groups,
    ).toEqual({
      direction: "ingress",
      policy_namespace: "tracker",
      policy: "tracker-default-deny",
    });
  });

  test("escapes Grafana legends for Helm and keeps LogQL braces", () => {
    const json = exportNetworkPolicyEnforcementDashboardJson();
    expect(json).toContain(`{{ print "{{" }}node{{ print "}}" }}`);
    expect(json).not.toMatch(/\{\{node\}\}/);
    expect(json).toContain("^E[0-9]{4} ");
  });
});
