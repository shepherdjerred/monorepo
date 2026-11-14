import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  breakGlassPolicy,
  fakeRunner,
  items,
  otherPolicy,
  stagingPolicy,
  type Call,
} from "./fixtures.ts";
import {
  APPLY_COMMAND,
  deleteCommand,
  parseOpenArguments,
  planClose,
  planOpen,
  reconcileInstruction,
  runOpen,
} from "./open-namespace.ts";
import type { NetworkPolicy } from "./staging-policy.ts";

const AppliedSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string(), namespace: z.string() }),
});

const NOW = new Date("2026-11-13T12:00:00.000Z");
const RECORD = { reason: "db down", operator: "admin@torvalds", at: NOW };

describe("arguments", () => {
  test("a dry run is the default", () => {
    expect(parseOpenArguments(["tracker"])).toEqual({
      target: { namespace: "tracker" },
      mode: "open",
      apply: false,
      reason: undefined,
    });
    expect(parseOpenArguments(["--all"]).target).toBe("all");
    expect(parseOpenArguments(["tracker", "--close"])).toMatchObject({
      mode: "close",
      apply: false,
    });
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
      mode: "open",
      apply: true,
      reason: "db down",
    });
  });

  test("--close --apply needs no reason and takes none", () => {
    expect(parseOpenArguments(["--all", "--close", "--apply"])).toEqual({
      target: "all",
      mode: "close",
      apply: true,
      reason: undefined,
    });
    expect(() =>
      parseOpenArguments(["tracker", "--close", "--reason", "x"]),
    ).toThrow("--close takes no --reason");
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
  stagingPolicy("tracker", "enforced"),
  otherPolicy("tracker", "tracker-app-netpol"),
  stagingPolicy("media", "open"),
  otherPolicy("flipt", "flipt-netpol"),
];

describe("open plan", () => {
  test("creates a break-glass policy per namespace and never names the staging policy", () => {
    const plans = planOpen(
      ["flipt", "media", "tracker"],
      [...policies, breakGlassPolicy("media")],
      RECORD,
    );
    expect(
      plans.map((plan) => [
        plan.namespace,
        plan.staging,
        plan.before,
        plan.action,
        plan.manifest.metadata.name,
      ]),
    ).toEqual([
      ["flipt", "none", "none", "create", "enforcement-break-glass-flipt"],
      ["media", "open", "open", "refresh", "enforcement-break-glass-media"],
      [
        "tracker",
        "enforced",
        "none",
        "create",
        "enforcement-break-glass-tracker",
      ],
    ]);
  });

  test("the reconcile instruction names the stage map entry and the close", () => {
    const text = reconcileInstruction(["tracker"]);
    expect(text).toContain(
      "packages/homelab/src/cdk8s/src/fleet-policy/enforcement-stages.ts",
    );
    expect(text).toContain('"tracker": "open"');
    expect(text).toContain("bun run netpol:open tracker --close --apply");
    expect(reconcileInstruction(["flipt", "tracker"])).toContain(
      "bun run netpol:open --all --close --apply",
    );
    expect(reconcileInstruction([])).toContain("nothing to reconcile");
  });
});

/** A cluster whose policies become `after` once a write has run. */
function cluster(before: NetworkPolicy[], after: NetworkPolicy[] = before) {
  let written = false;
  const write = () => {
    written = true;
    return { stdout: "ok" };
  };
  return fakeRunner([
    ["get networkpolicies", () => items(...(written ? after : before))],
    ["get namespace", { stdout: "{}" }],
    ["config current-context", { stdout: "admin@torvalds\n" }],
    ["kubectl apply", write],
    [" delete ", write],
  ]);
}

function writes(calls: readonly Call[]): Call[] {
  return calls.filter(
    ({ command }) => command.includes("apply") || command.includes("delete"),
  );
}

function dependencies(run: ReturnType<typeof cluster>["run"]) {
  return { run, now: () => NOW };
}

describe("open", () => {
  test("the dry run prints the manifest and the change, and only reads", async () => {
    const { run, calls } = cluster(policies);
    const result = await runOpen(
      parseOpenArguments(["tracker"]),
      dependencies(run),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("DRY RUN: nothing is changed.");
    expect(result.output).toContain(
      "Namespace tracker: create enforcement-break-glass-tracker (staging policy: enforced; break-glass before: none)",
    );
    expect(result.output).toContain("  name: enforcement-break-glass-tracker");
    expect(result.output).toContain('homelab.sjer.red/break-glass: "true"');
    expect(result.output).toContain(
      "homelab.sjer.red/break-glass-operator: admin@torvalds",
    );
    expect(result.output).toContain(
      "homelab.sjer.red/break-glass-at: 2026-11-13T12:00:00.000Z",
    );
    expect(result.output).toContain("  podSelector: {}");
    expect(result.output).not.toContain("enforcement-staging-tracker");
    expect(writes(calls)).toEqual([]);
  });

  test("a namespace that does not exist is refused", async () => {
    const { run } = fakeRunner([["get networkpolicies", items(...policies)]]);
    await expect(
      runOpen(parseOpenArguments(["typo"]), dependencies(run)),
    ).rejects.toThrow("get namespace typo");
  });

  test("applies only the break-glass policy, without forcing, and reads it back", async () => {
    const { run, calls } = cluster(policies, [
      ...policies,
      breakGlassPolicy("tracker"),
    ]);
    const result = await runOpen(
      parseOpenArguments(["tracker", "--apply", "--reason", "db down"]),
      dependencies(run),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("BREAK-GLASS APPLY, reason: db down");
    expect(result.output).toContain(
      "Namespace tracker: break-glass before none, after open",
    );
    expect(result.output).toContain("netpol:open tracker --close --apply");
    const [write, ...others] = writes(calls);
    expect(others).toEqual([]);
    expect(write?.command).toEqual([
      "kubectl",
      "apply",
      "--server-side",
      "--field-manager=network-policy-break-glass",
      "-f",
      "-",
    ]);
    expect(JSON.parse(write?.stdin ?? "")).toMatchObject({
      kind: "NetworkPolicy",
      metadata: {
        name: "enforcement-break-glass-tracker",
        namespace: "tracker",
        labels: { "homelab.sjer.red/break-glass": "true" },
        annotations: {
          "homelab.sjer.red/break-glass-reason": "db down",
          "homelab.sjer.red/break-glass-operator": "admin@torvalds",
          "homelab.sjer.red/break-glass-at": "2026-11-13T12:00:00.000Z",
        },
      },
      spec: { podSelector: {}, ingress: [{}], egress: [{}] },
    });
  });

  test("--all opens every namespace with policies and writes nothing else", async () => {
    const opened = ["flipt", "media", "tracker"].map((namespace) =>
      breakGlassPolicy(namespace),
    );
    const { run, calls } = cluster(policies, [...policies, ...opened]);
    const result = await runOpen(
      parseOpenArguments(["--all", "--apply", "--reason", "outage"]),
      dependencies(run),
    );
    expect(result.exitCode).toBe(0);
    expect(writes(calls).map(({ command }) => command)).toEqual([
      [...APPLY_COMMAND],
      [...APPLY_COMMAND],
      [...APPLY_COMMAND],
    ]);
    expect(
      writes(calls).map(({ stdin = "" }) => {
        const { kind, metadata } = AppliedSchema.parse(JSON.parse(stdin));
        return `${kind} ${metadata.namespace}/${metadata.name}`;
      }),
    ).toEqual([
      "NetworkPolicy flipt/enforcement-break-glass-flipt",
      "NetworkPolicy media/enforcement-break-glass-media",
      "NetworkPolicy tracker/enforcement-break-glass-tracker",
    ]);
  });

  test("a failed apply, or no open policy afterwards, exits non-zero", async () => {
    const missing = await runOpen(
      parseOpenArguments(["tracker", "--apply", "--reason", "db down"]),
      dependencies(cluster(policies).run),
    );
    expect(missing.exitCode).toBe(1);
    expect(missing.output).toContain(
      "after none FAILED: no open break-glass policy after the apply",
    );
    const { run } = fakeRunner([
      ["get networkpolicies", items(...policies)],
      ["get namespace", { stdout: "{}" }],
      ["config current-context", { stdout: "admin@torvalds" }],
      ["kubectl apply", { exitCode: 1, stderr: "forbidden" }],
    ]);
    const refused = await runOpen(
      parseOpenArguments(["tracker", "--apply", "--reason", "db down"]),
      dependencies(run),
    );
    expect(refused.exitCode).toBe(1);
    expect(refused.output).toContain("FAILED: kubectl apply");
    expect(refused.output).toContain("forbidden");
  });
});

const broken = [
  ...policies,
  breakGlassPolicy("tracker"),
  breakGlassPolicy("media", { name: "plex" }),
  breakGlassPolicy("flipt", { labelled: false }),
];

describe("close", () => {
  test("the plan deletes only the labelled policy with the expected name", () => {
    expect(planClose(["argocd", "flipt", "media", "tracker"], broken)).toEqual([
      { namespace: "argocd", staging: "none", deletable: false, refused: [] },
      {
        namespace: "flipt",
        staging: "none",
        deletable: false,
        refused: [
          "REFUSED flipt/enforcement-break-glass-flipt: has the break-glass name but not the label homelab.sjer.red/break-glass=true",
        ],
      },
      {
        namespace: "media",
        staging: "open",
        deletable: false,
        refused: [
          "REFUSED media/plex: carries the break-glass label but is not named enforcement-break-glass-media",
        ],
      },
      {
        namespace: "tracker",
        staging: "enforced",
        deletable: true,
        refused: [],
      },
    ]);
  });

  test("the delete is filtered by label and name on the server", () => {
    expect(deleteCommand("tracker")).toEqual([
      "kubectl",
      "--namespace",
      "tracker",
      "delete",
      "networkpolicies.networking.k8s.io",
      "--selector",
      "homelab.sjer.red/break-glass=true",
      "--field-selector",
      "metadata.name=enforcement-break-glass-tracker",
    ]);
  });

  test("the dry run says what would go and what governs afterwards, and only reads", async () => {
    const { run, calls } = cluster(broken);
    const result = await runOpen(
      parseOpenArguments(["tracker", "--close"]),
      dependencies(run),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("DRY RUN: nothing is changed.");
    expect(result.output).toContain(
      "Namespace tracker: would delete tracker/enforcement-break-glass-tracker; the namespace is then governed by its staging policy: enforced",
    );
    expect(writes(calls)).toEqual([]);
    const none = await runOpen(
      parseOpenArguments(["argocd", "--close"]),
      dependencies(cluster(broken).run),
    );
    expect(none.output).toContain(
      "Namespace argocd: no break-glass policy to delete",
    );
  });

  test("--all --apply deletes each real break-glass policy and refuses the rest", async () => {
    const { run, calls } = cluster(
      broken,
      broken.filter(
        (policy) => policy.metadata.name !== "enforcement-break-glass-tracker",
      ),
    );
    const result = await runOpen(
      parseOpenArguments(["--all", "--close", "--apply"]),
      dependencies(run),
    );
    expect(writes(calls).map(({ command }) => command)).toEqual([
      deleteCommand("tracker"),
    ]);
    expect(result.output).toContain(
      "Namespace tracker: deleted tracker/enforcement-break-glass-tracker",
    );
    expect(result.output).toContain("REFUSED media/plex");
    expect(result.output).toContain(
      "REFUSED flipt/enforcement-break-glass-flipt",
    );
    // A refusal is not a silent success.
    expect(result.exitCode).toBe(1);
  });

  test("a clean close exits zero; a policy that survives does not", async () => {
    const live = [...policies, breakGlassPolicy("tracker")];
    const clean = await runOpen(
      parseOpenArguments(["tracker", "--close", "--apply"]),
      dependencies(cluster(live, policies).run),
    );
    expect(clean.exitCode).toBe(0);
    const stuck = await runOpen(
      parseOpenArguments(["tracker", "--close", "--apply"]),
      dependencies(cluster(live).run),
    );
    expect(stuck.exitCode).toBe(1);
    expect(stuck.output).toContain("FAILED tracker: the policy still exists");
  });

  test("with nothing to close it says so", async () => {
    const result = await runOpen(
      parseOpenArguments(["--all", "--close", "--apply"]),
      dependencies(cluster(policies).run),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("No break-glass policy exists.");
  });
});
