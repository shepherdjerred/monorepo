import { describe, expect, test } from "vitest";
import {
  breakGlassCandidates,
  breakGlassManifest,
  breakGlassNamespaces,
  breakGlassPolicyName,
  breakGlassState,
  isBreakGlassPolicy,
  refusalOf,
} from "./break-glass.ts";
import { allowAllPolicy, breakGlassPolicy, otherPolicy } from "./fixtures.ts";
import {
  allowsEverythingForEveryPod,
  NetworkPolicySchema,
} from "./policies.ts";

const RECORD = {
  reason: "Tracker cannot reach PostgreSQL",
  operator: "admin@torvalds",
  at: new Date("2026-11-13T12:00:00.000Z"),
};

describe("break-glass name", () => {
  test("is enforcement-break-glass-<namespace>", () => {
    expect(breakGlassPolicyName("tracker")).toBe(
      "enforcement-break-glass-tracker",
    );
    expect(() => breakGlassPolicyName("kube-system; rm")).toThrow();
  });
});

describe("break-glass manifest", () => {
  const manifest = breakGlassManifest("tracker", RECORD);

  test("is a separate allow-all policy with its record", () => {
    expect(manifest).toEqual({
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: {
        name: "enforcement-break-glass-tracker",
        namespace: "tracker",
        labels: { "homelab.sjer.red/break-glass": "true" },
        annotations: {
          "homelab.sjer.red/break-glass-reason":
            "Tracker cannot reach PostgreSQL",
          "homelab.sjer.red/break-glass-operator": "admin@torvalds",
          "homelab.sjer.red/break-glass-at": "2026-11-13T12:00:00.000Z",
        },
      },
      spec: {
        podSelector: {},
        policyTypes: ["Ingress", "Egress"],
        ingress: [{}],
        egress: [{}],
      },
    });
  });

  test("carries nothing ArgoCD tracks a resource by", () => {
    const keys = [
      ...Object.keys(manifest.metadata.labels),
      ...Object.keys(manifest.metadata.annotations),
    ];
    expect(keys.filter((key) => key.includes("argocd"))).toEqual([]);
    expect(keys.filter((key) => key.startsWith("app.kubernetes.io/"))).toEqual(
      [],
    );
  });

  test("reads back as the open break-glass policy", () => {
    const live = NetworkPolicySchema.parse(manifest);
    expect(isBreakGlassPolicy(live)).toBe(true);
    expect(breakGlassState([live], "tracker")).toBe("open");
    expect(allowsEverythingForEveryPod(live)).toBe(true);
  });
});

describe("break-glass detection", () => {
  const policies = [
    // An allow-all policy that is not a break-glass one.
    allowAllPolicy("tracker", "tracker-open"),
    otherPolicy("tracker", "tracker-app"),
    breakGlassPolicy("tracker"),
    // The label on another name, and the name without the label.
    breakGlassPolicy("media", { name: "plex" }),
    breakGlassPolicy("flipt", { labelled: false }),
    // Named for another namespace: a label match only.
    breakGlassPolicy("redlib", { name: "enforcement-break-glass-tracker" }),
    otherPolicy("argocd", "argocd-server"),
  ];

  test("only the label AND the namespace's own name is the break-glass policy", () => {
    expect(
      policies
        .filter((policy) => isBreakGlassPolicy(policy))
        .map((policy) => policy.metadata.namespace),
    ).toEqual(["tracker"]);
  });

  test("half-matching objects are candidates, with the reason they are refused", () => {
    expect(
      breakGlassCandidates(policies, "tracker").map((p) => p.metadata.name),
    ).toEqual(["enforcement-break-glass-tracker"]);
    const refusals = (namespace: string) =>
      breakGlassCandidates(policies, namespace).map((policy) =>
        refusalOf(policy),
      );
    expect(refusals("tracker")).toEqual([undefined]);
    expect(refusals("media")).toEqual([
      "carries the break-glass label but is not named enforcement-break-glass-media",
    ]);
    expect(refusals("flipt")).toEqual([
      "has the break-glass name but not the label homelab.sjer.red/break-glass=true",
    ]);
    expect(refusals("redlib")).toEqual([
      "carries the break-glass label but is not named enforcement-break-glass-redlib",
    ]);
    expect(refusals("argocd")).toEqual([]);
  });

  test("state is open only for the real allow-all policy", () => {
    expect(breakGlassState(policies, "tracker")).toBe("open");
    expect(breakGlassState(policies, "media")).toBe("unrecognized");
    expect(breakGlassState(policies, "flipt")).toBe("unrecognized");
    expect(breakGlassState(policies, "argocd")).toBe("none");
    const narrowed = breakGlassPolicy("tracker");
    narrowed.spec.egress = [];
    expect(breakGlassState([narrowed], "tracker")).toBe("unrecognized");
  });

  test("namespaces with any candidate are found", () => {
    expect(breakGlassNamespaces(policies)).toEqual([
      "flipt",
      "media",
      "redlib",
      "tracker",
    ]);
  });
});
