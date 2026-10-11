import { describe, expect, it } from "vitest";
import {
  CI_WORKSPACE_LEAK_AGE_SECONDS,
  CI_WORKSPACE_STORAGE_CLASS,
  planCiWorkspaceReap,
  reapCiWorkspaces,
  type CiWorkspaceReaperClient,
  type ReaperClaim,
  type ReaperDeleteOutcome,
  type ReaperPod,
} from "./ci-workspace-reaper.ts";

const NOW = new Date("2026-10-11T22:00:00.000Z");
const LEAK_AGE_MS = CI_WORKSPACE_LEAK_AGE_SECONDS * 1000;
const OLD = new Date(NOW.getTime() - LEAK_AGE_MS - 60_000);
const YOUNG = new Date(NOW.getTime() - 60_000);
const TASK_LABELS = { "woodpecker-ci.org/task-uuid": "task" };

function pod(overrides: Partial<ReaperPod> & { name: string }): ReaperPod {
  return {
    uid: `uid-${overrides.name}`,
    phase: "Failed",
    createdAt: OLD,
    deleting: false,
    labels: TASK_LABELS,
    claimNames: [],
    ...overrides,
  };
}

function claim(
  overrides: Partial<ReaperClaim> & { name: string },
): ReaperClaim {
  return {
    uid: `uid-${overrides.name}`,
    storageClassName: CI_WORKSPACE_STORAGE_CLASS,
    createdAt: OLD,
    deleting: false,
    ...overrides,
  };
}

/** A creation time this many minutes before OLD. */
function at(minutes: number): Date {
  return new Date(OLD.getTime() - minutes * 60_000);
}

const names = (items: readonly { name: string }[]): string[] =>
  items.map((item) => item.name);

describe("planCiWorkspaceReap", () => {
  it("selects terminal Woodpecker pods only once they are older than the leak age", () => {
    const atBoundary = new Date(NOW.getTime() - LEAK_AGE_MS);
    const plan = planCiWorkspaceReap(
      [
        pod({ name: "wp-failed" }),
        pod({ name: "wp-succeeded", phase: "Succeeded" }),
        pod({ name: "wp-unknown", phase: "Unknown" }),
        pod({ name: "wp-svc-paper", phase: "Failed" }),
        pod({ name: "wp-running", phase: "Running" }),
        pod({ name: "wp-pending", phase: "Pending" }),
        pod({ name: "wp-young", createdAt: YOUNG }),
        pod({ name: "wp-boundary", createdAt: atBoundary }),
        pod({ name: "wp-terminating", deleting: true }),
      ],
      [],
      NOW,
    );
    expect(names(plan.pods).toSorted()).toEqual([
      "wp-failed",
      "wp-succeeded",
      "wp-svc-paper",
      "wp-unknown",
    ]);
  });

  it("never touches pods Woodpecker did not create", () => {
    const plan = planCiWorkspaceReap(
      [
        pod({ name: "temporal-maintenance-worker-abc", phase: "Failed" }),
        pod({ name: "wp-unlabelled", labels: {} }),
        pod({ name: "debug-wp-copy" }),
      ],
      [],
      NOW,
    );
    expect(plan.pods).toEqual([]);
  });

  it("selects only old ci-workspace claims named by Woodpecker", () => {
    const plan = planCiWorkspaceReap(
      [],
      [
        claim({ name: "wp-old-0-default" }),
        claim({ name: "wp-young-0-default", createdAt: YOUNG }),
        claim({
          name: "woodpecker-bun-cache",
          storageClassName: "zfs-ssd-lz4",
        }),
        claim({ name: "wp-other-class", storageClassName: "zfs-ssd-lz4" }),
        claim({ name: "wp-no-class", storageClassName: undefined }),
        claim({ name: "manual-scratch" }),
        claim({ name: "wp-terminating-0-default", deleting: true }),
      ],
      NOW,
    );
    expect(names(plan.claims)).toEqual(["wp-old-0-default"]);
  });

  it("keeps a claim mounted by any pod this run does not delete", () => {
    const plan = planCiWorkspaceReap(
      [
        pod({
          name: "wp-running",
          phase: "Running",
          claimNames: ["wp-a-0-default", "woodpecker-bun-cache"],
        }),
        pod({
          name: "wp-terminating",
          deleting: true,
          claimNames: ["wp-b-0-default"],
        }),
        pod({
          name: "wp-young-failed",
          createdAt: YOUNG,
          claimNames: ["wp-c-0-default"],
        }),
        pod({ name: "wp-old-failed", claimNames: ["wp-d-0-default"] }),
      ],
      [
        claim({ name: "wp-a-0-default" }),
        claim({ name: "wp-b-0-default" }),
        claim({ name: "wp-c-0-default" }),
        claim({ name: "wp-d-0-default" }),
      ],
      NOW,
    );
    expect(names(plan.pods)).toEqual(["wp-old-failed"]);
    expect(names(plan.claims)).toEqual(["wp-d-0-default"]);
    expect(plan.mountedClaims).toEqual([
      "wp-a-0-default",
      "wp-b-0-default",
      "wp-c-0-default",
    ]);
  });

  it("drains a backlog oldest-first and protects claims of deferred pods", () => {
    const plan = planCiWorkspaceReap(
      [
        pod({ name: "wp-p3", createdAt: at(1), claimNames: ["wp-c3"] }),
        pod({ name: "wp-p1", createdAt: at(3), claimNames: ["wp-c1"] }),
        pod({ name: "wp-p2", createdAt: at(2), claimNames: ["wp-c2"] }),
      ],
      [
        claim({ name: "wp-c1", createdAt: at(3) }),
        claim({ name: "wp-c2", createdAt: at(2) }),
        claim({ name: "wp-c3", createdAt: at(1) }),
        claim({ name: "wp-c4", createdAt: at(4) }),
      ],
      NOW,
      2,
    );
    expect(names(plan.pods)).toEqual(["wp-p1", "wp-p2"]);
    expect(plan.deferredPods).toBe(1);
    expect(plan.mountedClaims).toEqual(["wp-c3"]);
    expect(names(plan.claims)).toEqual(["wp-c4", "wp-c1"]);
    expect(plan.deferredClaims).toBe(1);
  });
});

describe("reapCiWorkspaces", () => {
  it("deletes pods before claims with UID preconditions and tolerates races", async () => {
    const calls: string[] = [];
    const outcomes: Record<string, ReaperDeleteOutcome> = {
      "pod/wp-gone": "gone",
      "claim/wp-replaced-0-default": "changed",
    };
    const client: CiWorkspaceReaperClient = {
      listPods: () =>
        Promise.resolve([
          pod({ name: "wp-step", claimNames: ["wp-step-0-default"] }),
          pod({ name: "wp-gone" }),
        ]),
      listClaims: () =>
        Promise.resolve([
          claim({ name: "wp-step-0-default" }),
          claim({ name: "wp-replaced-0-default" }),
        ]),
      deletePod: (name, uid) => {
        calls.push(`pod/${name}@${uid}`);
        return Promise.resolve(outcomes[`pod/${name}`] ?? "deleted");
      },
      deleteClaim: (name, uid) => {
        calls.push(`claim/${name}@${uid}`);
        return Promise.resolve(outcomes[`claim/${name}`] ?? "deleted");
      },
    };
    const heartbeats: unknown[] = [];

    const result = await reapCiWorkspaces(client, NOW, (progress) =>
      heartbeats.push(progress),
    );

    expect(calls).toEqual([
      "pod/wp-gone@uid-wp-gone",
      "pod/wp-step@uid-wp-step",
      "claim/wp-replaced-0-default@uid-wp-replaced-0-default",
      "claim/wp-step-0-default@uid-wp-step-0-default",
    ]);
    expect(result.deletedPods).toEqual(["wp-step"]);
    expect(result.deletedClaims).toEqual(["wp-step-0-default"]);
    expect(result.skipped).toEqual([
      "pod/wp-gone (gone)",
      "persistentvolumeclaim/wp-replaced-0-default (changed)",
    ]);
    expect(heartbeats).toHaveLength(4);
  });

  it("surfaces unexpected API failures so the Activity retries", async () => {
    const client: CiWorkspaceReaperClient = {
      listPods: () => Promise.resolve([pod({ name: "wp-step" })]),
      listClaims: () => Promise.resolve([]),
      deletePod: () => Promise.reject(new Error("forbidden")),
      deleteClaim: () => Promise.resolve("deleted"),
    };
    await expect(reapCiWorkspaces(client, NOW)).rejects.toThrow("forbidden");
  });
});
