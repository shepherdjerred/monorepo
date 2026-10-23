import { afterEach, describe, expect, test, vi } from "vitest";
import { deliveryOperationId } from "@shepherdjerred/delivery/operation-id";
import { renderApplication } from "#lib/delivery/model/application.ts";
import { forumDetail } from "#lib/delivery/model/forum-testing.ts";
import { artifact } from "#lib/delivery/model/testing.ts";
import type * as Activity from "@temporalio/activity";
import type * as ArgoClient from "#lib/delivery/argo-client.ts";
import type * as Argocd from "#activities/delivery/argocd.ts";
import type * as Stages from "./stages.ts";

const calls = vi.hoisted(() => {
  const events: string[] = [];
  const reads: unknown[] = [];
  return { events, reads };
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
vi.mock("./oci-chart.ts", () => ({
  verifyOciChart: (chart: { id: string }, operationId: string) =>
    Promise.resolve({
      kind: "preflight",
      operationId,
      summary: `Source ${chart.id} still resolves to its frozen digest`,
    }),
}));
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
  runGuardedArgoCommand: (args: string[]) => {
    calls.events.push(args.join(" "));
    return Promise.resolve();
  },
}));
vi.mock("./stages.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Stages>()),
  recordStage: (_current: unknown, key: string, status: string) => {
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
}));

const { applySafety, sync } = await import("./kubernetes.ts");

/** The forum release, its chart in a store the sync reads by version. */
function fixture() {
  return forumDetail(
    [],
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
  const rendered = renderApplication(current, recipe);
  const info = [
    {
      name: "ci.sjer.red/request-id",
      value: deliveryOperationId(current.deployment.id),
    },
    { name: "ci.sjer.red/operation-id", value: "operation-1" },
  ];
  return {
    metadata: { ...rendered.body.metadata, uid: "application-uid" },
    spec: { source: rendered.source },
    status: synced
      ? {
          sync: { status: "Synced", revision: rendered.revision },
          health: { status: "Healthy" },
          operationState: {
            phase: "Succeeded",
            operation: { info },
            syncResult: { revision: rendered.revision },
          },
        }
      : {},
  };
}

afterEach(() => {
  calls.events = [];
  calls.reads = [];
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

  test("the sync applies the written source without re-checking the baseline", async () => {
    const { current, recipe } = fixture();
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(calls.events).toContain(
      [
        "sync-managed storm-forum --revision 1.0.1 --request-id",
        deliveryOperationId(current.deployment.id),
        "--timeout 1200",
      ].join(" "),
    );
    // The baseline was re-observed before the source changed, not here.
    expect(calls.events).not.toContain("baseline-check");
  });
});
