import { describe, expect, test } from "vitest";
import { otherPolicy, stagingPolicy } from "./fixtures.ts";
import {
  namespacesWithPolicies,
  NetworkPolicySchema,
  stagedNamespaces,
  stageOf,
  stagingPolicyName,
  stagingPolicyOf,
} from "./staging-policy.ts";

describe("staging policy name", () => {
  test("is enforcement-staging-<namespace>, as cdk8s renders it", () => {
    expect(stagingPolicyName("tracker")).toBe("enforcement-staging-tracker");
    expect(stagingPolicyName("trmnl-dashboard")).toBe(
      "enforcement-staging-trmnl-dashboard",
    );
  });

  test("refuses a name that is not a namespace", () => {
    for (const name of ["", "Tracker", "a b", "-x", "x/../y"]) {
      expect(() => stagingPolicyName(name)).toThrow();
    }
  });
});

describe("stage detection", () => {
  test("an allow-all policy that selects every pod is open", () => {
    expect(stageOf(stagingPolicy("tracker", "open"))).toBe("open");
  });

  test("the never-label selector is enforced", () => {
    expect(stageOf(stagingPolicy("tracker", "enforced"))).toBe("enforced");
  });

  test("no policy is none", () => {
    expect(stageOf(undefined)).toBe("none");
  });

  test("any other selector or a selecting policy that is not allow-all is unrecognized", () => {
    const open = stagingPolicy("tracker", "open");
    const cases = [
      { ...open.spec, podSelector: { matchLabels: { app: "tracker" } } },
      {
        ...open.spec,
        podSelector: {
          matchLabels: { "homelab.sjer.red/enforcement-staging": "sometimes" },
        },
      },
      {
        ...open.spec,
        podSelector: { matchExpressions: [{ key: "app", operator: "Exists" }] },
      },
      { ...open.spec, egress: [] },
      { ...open.spec, ingress: [{ from: [{ podSelector: {} }] }] },
      { ...open.spec, policyTypes: ["Ingress"] },
    ];
    for (const spec of cases) {
      expect(stageOf({ ...open, spec })).toBe("unrecognized");
    }
  });

  test("parses the selector shapes kubectl prints", () => {
    const parsed = NetworkPolicySchema.parse({
      apiVersion: "networking.k8s.io/v1",
      metadata: { name: "enforcement-staging-tracker", namespace: "tracker" },
      spec: {
        podSelector: {},
        policyTypes: ["Ingress", "Egress"],
        ingress: [{}],
        egress: [{}],
      },
    });
    expect(stageOf(parsed)).toBe("open");
  });
});

describe("discovery", () => {
  const policies = [
    stagingPolicy("tracker", "enforced"),
    otherPolicy("tracker", "tracker-app-netpol"),
    otherPolicy("media", "plex"),
    // Named for another namespace, or the old fixed name: not a staging policy.
    otherPolicy("flipt", "enforcement-staging-tracker"),
    otherPolicy("redlib", "enforcement-staging"),
    stagingPolicy("alert-dashboard", "open"),
  ];

  test("a namespace's staging policy is the one named for it", () => {
    expect(stagingPolicyOf(policies, "tracker")?.metadata.name).toBe(
      "enforcement-staging-tracker",
    );
    expect(stagingPolicyOf(policies, "flipt")).toBeUndefined();
    expect(stagingPolicyOf(policies, "redlib")).toBeUndefined();
    expect(stagingPolicyOf(policies, "media")).toBeUndefined();
  });

  test("staged namespaces are those with their own staging policy", () => {
    expect(stagedNamespaces(policies)).toEqual(["alert-dashboard", "tracker"]);
  });

  test("namespaces with policies are every namespace with any policy", () => {
    expect(namespacesWithPolicies(policies)).toEqual([
      "alert-dashboard",
      "flipt",
      "media",
      "redlib",
      "tracker",
    ]);
  });
});
