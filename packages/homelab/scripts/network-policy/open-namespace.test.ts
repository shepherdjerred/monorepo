import { describe, expect, test } from "vitest";
import { z } from "zod";
import { fakeRunner, items, otherPolicy, stagingPolicy } from "./fixtures.ts";
import {
  APPLY_COMMAND,
  parseOpenArguments,
  planOpen,
  reconcileInstruction,
  runOpen,
} from "./open-namespace.ts";

const AppliedSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string(), namespace: z.string() }),
});

describe("arguments", () => {
  test("a dry run is the default", () => {
    expect(parseOpenArguments(["tracker"])).toEqual({
      target: { namespace: "tracker" },
      apply: false,
      reason: undefined,
    });
    expect(parseOpenArguments(["--all"]).target).toBe("all");
  });

  test("--apply is refused without a reason", () => {
    for (const argv of [
      ["tracker", "--apply"],
      ["tracker", "--apply", "--reason", ""],
      ["tracker", "--apply", "--reason", "   "],
      ["--all", "--apply"],
    ]) {
      expect(() => parseOpenArguments(argv)).toThrow("requires --reason");
    }
    expect(
      parseOpenArguments(["tracker", "--apply", "--reason", " db down "]),
    ).toEqual({
      target: { namespace: "tracker" },
      apply: true,
      reason: "db down",
    });
  });

  test("refuses no target, two targets, bad names and unknown flags", () => {
    for (const argv of [
      [],
      ["tracker", "--all"],
      ["tracker", "media"],
      ["Tracker"],
      ["tracker", "--delete"],
    ]) {
      expect(() => parseOpenArguments(argv)).toThrow();
    }
  });
});

const policies = [
  stagingPolicy("tracker", "enforced", "tracker"),
  otherPolicy("tracker", "tracker-app-netpol"),
  stagingPolicy("media", "open", "media"),
  otherPolicy("flipt", "flipt-netpol"),
];

describe("plan", () => {
  test("updates an enforced namespace, creates a missing policy, leaves an open one", () => {
    const plans = planOpen(["flipt", "media", "tracker"], policies, undefined);
    expect(
      plans.map((plan) => [plan.namespace, plan.before, plan.action]),
    ).toEqual([
      ["flipt", "none", "create"],
      ["media", "open", "unchanged"],
      ["tracker", "enforced", "update"],
    ]);
    expect(plans.map((plan) => plan.manifest.metadata.name)).toEqual([
      "enforcement-staging-flipt",
      "enforcement-staging-media",
      "enforcement-staging-tracker",
    ]);
    expect(plans[2]?.application).toBe("tracker");
  });

  test("the reconcile instruction names the stage map entry", () => {
    const text = reconcileInstruction(["tracker"]);
    expect(text).toContain(
      "packages/homelab/src/cdk8s/src/fleet-policy/enforcement-stages.ts",
    );
    expect(text).toContain('"tracker": "open"');
    expect(reconcileInstruction([])).toContain("nothing to reconcile");
  });
});

function cluster(after = policies) {
  let applied = false;
  return fakeRunner([
    ["get networkpolicies", () => items(...(applied ? after : policies))],
    ["get namespace", { stdout: "{}" }],
    [
      "kubectl apply",
      () => {
        applied = true;
        return { stdout: "applied" };
      },
    ],
  ]);
}

describe("dry run", () => {
  test("prints the manifest and the change, and only reads", async () => {
    const { run, calls } = cluster();
    const result = await runOpen(parseOpenArguments(["tracker"]), run);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("DRY RUN: nothing is changed.");
    expect(result.output).toContain(
      "Namespace tracker: update enforcement-staging-tracker: enforced -> open (rendered by ArgoCD Application tracker)",
    );
    expect(result.output).toContain("  name: enforcement-staging-tracker");
    expect(result.output).toContain("  podSelector: {}");
    expect(result.output).toContain('"tracker": "open"');
    expect(calls.map(({ command }) => command[1])).toEqual(["get", "get"]);
  });

  test("a namespace that does not exist is refused", async () => {
    const { run } = fakeRunner([["get networkpolicies", items(...policies)]]);
    await expect(runOpen(parseOpenArguments(["typo"]), run)).rejects.toThrow(
      "get namespace typo",
    );
  });
});

describe("apply", () => {
  const opened = [
    stagingPolicy("tracker", "open", "tracker"),
    stagingPolicy("media", "open", "media"),
    stagingPolicy("flipt", "open"),
  ];

  test("applies only the staging policy, server-side, and reads it back", async () => {
    const { run, calls } = cluster(opened);
    const result = await runOpen(
      parseOpenArguments(["tracker", "--apply", "--reason", "db down"]),
      run,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("BREAK-GLASS APPLY, reason: db down");
    expect(result.output).toContain(
      "Namespace tracker: before enforced, after open",
    );
    expect(result.output).toContain('"tracker": "open"');
    const writes = calls.filter(({ command }) => command[1] !== "get");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.command).toEqual([
      "kubectl",
      "apply",
      "--server-side",
      "--force-conflicts",
      "--field-manager=network-policy-break-glass",
      "-f",
      "-",
    ]);
    expect(JSON.parse(writes[0]?.stdin ?? "")).toMatchObject({
      kind: "NetworkPolicy",
      metadata: {
        name: "enforcement-staging-tracker",
        namespace: "tracker",
        annotations: { "homelab.sjer.red/break-glass-reason": "db down" },
      },
      spec: { podSelector: {} },
    });
  });

  test("--all opens every namespace with policies and never touches another policy", async () => {
    const { run, calls } = cluster(opened);
    const result = await runOpen(
      parseOpenArguments(["--all", "--apply", "--reason", "outage"]),
      run,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      "Namespace media: already open, nothing to apply",
    );
    const writes = calls.filter(({ command }) => command[1] !== "get");
    expect(writes.map(({ command }) => command)).toEqual([
      [...APPLY_COMMAND],
      [...APPLY_COMMAND],
    ]);
    expect(
      writes.map(({ stdin = "" }) => {
        const { kind, metadata } = AppliedSchema.parse(JSON.parse(stdin));
        return `${kind} ${metadata.namespace}/${metadata.name}`;
      }),
    ).toEqual([
      "NetworkPolicy flipt/enforcement-staging-flipt",
      "NetworkPolicy tracker/enforcement-staging-tracker",
    ]);
  });

  test("a failed apply, or a policy still closed afterwards, exits non-zero", async () => {
    const stillClosed = await runOpen(
      parseOpenArguments(["tracker", "--apply", "--reason", "db down"]),
      cluster(policies).run,
    );
    expect(stillClosed.exitCode).toBe(1);
    expect(stillClosed.output).toContain(
      "after enforced FAILED: the policy is not open after the apply",
    );
    const { run } = fakeRunner([
      ["get networkpolicies", items(...policies)],
      ["get namespace", { stdout: "{}" }],
      ["kubectl apply", { exitCode: 1, stderr: "forbidden" }],
    ]);
    const refused = await runOpen(
      parseOpenArguments(["tracker", "--apply", "--reason", "db down"]),
      run,
    );
    expect(refused.exitCode).toBe(1);
    expect(refused.output).toContain("FAILED: kubectl apply");
    expect(refused.output).toContain("forbidden");
  });
});
