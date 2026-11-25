import { describe, expect, test } from "vitest";
import { allowAllPolicy, otherPolicy } from "./fixtures.ts";
import {
  allowsEverythingForEveryPod,
  NamespaceNameSchema,
  namespacesWithPolicies,
  NetworkPolicySchema,
} from "./policies.ts";

describe("namespace names", () => {
  test("refuses a name that is not a namespace", () => {
    for (const name of ["", "Tracker", "a b", "-x", "x/../y"]) {
      expect(NamespaceNameSchema.safeParse(name).success).toBe(false);
    }
  });

  test("accepts a namespace name", () => {
    expect(NamespaceNameSchema.parse("trmnl-dashboard")).toBe(
      "trmnl-dashboard",
    );
  });
});

describe("allow-all detection", () => {
  test("a policy that selects every pod and allows everything both ways", () => {
    expect(allowsEverythingForEveryPod(allowAllPolicy("tracker", "open"))).toBe(
      true,
    );
  });

  test("any narrower selector, rule or policy type is not allow-all", () => {
    const open = allowAllPolicy("tracker", "open");
    const cases = [
      { ...open.spec, podSelector: { matchLabels: { app: "tracker" } } },
      {
        ...open.spec,
        podSelector: { matchExpressions: [{ key: "app", operator: "Exists" }] },
      },
      { ...open.spec, egress: [] },
      { ...open.spec, ingress: [{ from: [{ podSelector: {} }] }] },
      { ...open.spec, policyTypes: ["Ingress"] },
    ];
    for (const spec of cases) {
      expect(allowsEverythingForEveryPod({ ...open, spec })).toBe(false);
    }
  });

  test("parses the selector shapes kubectl prints", () => {
    const parsed = NetworkPolicySchema.parse({
      apiVersion: "networking.k8s.io/v1",
      metadata: { name: "enforcement-staging-flags", namespace: "flags" },
      spec: {
        podSelector: {},
        policyTypes: ["Ingress", "Egress"],
        ingress: [{}],
        egress: [{}],
      },
    });
    expect(allowsEverythingForEveryPod(parsed)).toBe(true);
  });
});

test("namespaces with policies are every namespace with any policy", () => {
  expect(
    namespacesWithPolicies([
      otherPolicy("tracker", "tracker-app-netpol"),
      otherPolicy("media", "plex"),
      otherPolicy("tracker", "tracker-db-netpol"),
      allowAllPolicy("flags", "enforcement-staging-flags"),
    ]),
  ).toEqual(["flags", "media", "tracker"]);
});
