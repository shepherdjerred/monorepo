import { afterEach, describe, expect, test, vi } from "vitest";
import { deliveryOperationId } from "@shepherdjerred/delivery/operation-id";
import { argoApplication } from "#lib/delivery/model/step-testing.ts";
import { forumDetail } from "#lib/delivery/model/forum-testing.ts";
import { artifact } from "#lib/delivery/model/testing.ts";
import type * as Activity from "@temporalio/activity";
import type * as ArgoClient from "#lib/delivery/argo-client.ts";
import type * as Argocd from "#activities/delivery/argocd.ts";
import type * as Stages from "./stages.ts";

const calls = vi.hoisted(() => {
  const events: string[] = [];
  const reads: unknown[] = [];
  return { events, reads, prune: false, lapsed: false };
});
vi.mock("@temporalio/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof Activity>()),
  Context: {
    current: () => ({
      cancellationSignal: new AbortController().signal,
      heartbeat: vi.fn(),
    }),
  },
}));
// The forum chart's tag still resolves to its frozen digest; oci-chart.test.ts
// covers a moved tag.
vi.mock("./oci-chart.ts", async () => {
  const { frozenOciChart } =
    await import("#lib/delivery/model/step-testing.ts");
  return frozenOciChart;
});
vi.mock("#lib/delivery/argo-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ArgoClient>()),
  getArgoApplication: () => {
    calls.events.push("read");
    return Promise.resolve(
      calls.reads.length > 1 ? calls.reads.shift() : calls.reads[0],
    );
  },
  createArgoApplication: () => {
    calls.events.push("write");
    return Promise.resolve();
  },
}));
vi.mock("#activities/delivery/argocd.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Argocd>()),
  argoRequest: () => Promise.resolve(null),
  runGuardedArgoCommand: (args: string[]) => {
    calls.events.push(args.join(" "));
    return Promise.resolve();
  },
}));
vi.mock("./stages.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Stages>()),
  recordStage: (_current: unknown, key: string, status: string) => {
    // The server refuses any stage write once the lease has lapsed (D7).
    if (calls.lapsed)
      return Promise.reject(
        new Error(
          "The deployment's lease lapsed; it is no longer provably owned and ends in recovery (D7)",
        ),
      );
    calls.events.push(`${key} ${status}`);
    return Promise.resolve();
  },
  requireOwned: () => Promise.resolve(fixture().current),
}));
vi.mock("./forum-bundle.ts", () => ({
  forumBaselineFence: () => {
    calls.events.push("baseline-check");
    return Promise.resolve();
  },
  forumSyncPrune: () => Promise.resolve(calls.prune),
}));

const { applySafety, sync } = await import("./kubernetes.ts");

/** The forum release, its chart in a store the sync reads by version. */
function fixture(stages: { key: string; status: "running" }[] = []) {
  return forumDetail(
    stages,
    artifact({
      id: "chart/forum",
      component: "chart:storm-forum",
      kind: "chart",
      uri: "oci://registry.example/storm-forum",
      version: "1.0.1",
      character: "b",
    }),
  );
}

/** The written Application, before and after this deployment's owned sync. */
function application(synced: boolean) {
  const { current, recipe } = fixture();
  return argoApplication(current, recipe, synced);
}

afterEach(() => {
  calls.events = [];
  calls.reads = [];
  calls.prune = false;
  calls.lapsed = false;
});

describe("Kubernetes steps of a forum release", () => {
  test("apply-safety re-observes the original baseline before writing the candidate source", async () => {
    const { current, recipe } = fixture();
    calls.reads = [null];
    await applySafety(current, recipe, "step-apply-safety");
    expect(calls.events.slice(0, 4)).toEqual([
      "baseline-check",
      "step-apply-safety running",
      "read",
      "write",
    ]);
  });

  test("a resumed apply-safety keeps its recorded intent and skips the baseline check", async () => {
    // The server refuses the check once the step's stage exists.
    const { current, recipe } = fixture([
      { key: "step-apply-safety", status: "running" },
    ]);
    calls.reads = [null];
    await applySafety(current, recipe, "step-apply-safety");
    expect(calls.events).not.toContain("baseline-check");
    expect(calls.events.slice(0, 3)).toEqual([
      "step-apply-safety running",
      "read",
      "write",
    ]);
  });

  test.each([
    [true, ["--prune"]],
    [false, []],
  ])(
    "the sync prunes the prior release Job only when the guard allows it (%s)",
    async (prune, flags) => {
      const { current, recipe } = fixture();
      calls.prune = prune;
      calls.reads = [application(false), application(true)];
      await sync(current, recipe, "step-sync");
      const command = calls.events.find((event) =>
        event.startsWith("sync-managed"),
      );
      expect(command).toBe(
        [
          "sync-managed storm-forum --revision 1.0.1 --request-id",
          deliveryOperationId(current.deployment.id),
          ...flags,
          "--timeout 1200",
        ].join(" "),
      );
      // The baseline was re-observed before the source changed, not here.
      expect(calls.events).not.toContain("baseline-check");
    },
  );

  test("a resumed sync re-records its intent before the Argo sync (D7)", async () => {
    const { current, recipe } = fixture([
      { key: "step-sync", status: "running" },
    ]);
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    const intent = calls.events.indexOf("step-sync running");
    const effect = calls.events.findIndex((event) =>
      event.startsWith("sync-managed"),
    );
    expect(intent).toBeGreaterThanOrEqual(0);
    expect(intent).toBeLessThan(effect);
  });

  test("a resumed sync whose lease lapsed is refused at its intent before any Argo sync (D7)", async () => {
    const { current, recipe } = fixture([
      { key: "step-sync", status: "running" },
    ]);
    calls.reads = [application(false)];
    calls.lapsed = true;
    await expect(sync(current, recipe, "step-sync")).rejects.toThrow(
      /lease lapsed/u,
    );
    expect(calls.events).toEqual(["read"]);
  });
});
