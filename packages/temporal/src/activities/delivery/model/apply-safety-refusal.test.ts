import { afterEach, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { forumDetail } from "#lib/delivery/model/forum-testing.ts";
import { artifact } from "#lib/delivery/model/testing.ts";
import type * as Activity from "@temporalio/activity";
import type * as ArgoClient from "#lib/delivery/argo-client.ts";
import type * as Argocd from "#activities/delivery/argocd.ts";
import type * as Stages from "./stages.ts";

/**
 * temporal/prod c0025f42 (2026-11-07): assert-apply-safe refused after the
 * candidate body was written, the stage stayed running, and the stale body
 * stalled the next release. A refusal now undoes the write and settles.
 */
const state = vi.hoisted(() => {
  const events: string[] = [];
  const reads: unknown[] = [];
  const updates: unknown[] = [];
  const stages: { key: string; status: string; receipt: unknown }[] = [];
  return { events, reads, updates, stages, failRestore: false };
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
vi.mock("./oci-chart.ts", async () => {
  const { frozenOciChart } =
    await import("#lib/delivery/model/step-testing.ts");
  return frozenOciChart;
});
vi.mock("#lib/delivery/argo-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ArgoClient>()),
  getArgoApplication: () => {
    state.events.push("read");
    return Promise.resolve(
      state.reads.length > 1 ? state.reads.shift() : state.reads[0],
    );
  },
  createArgoApplication: () => {
    state.events.push("create");
    return Promise.resolve();
  },
  updateArgoApplication: (_name: string, body: unknown) => {
    state.events.push("update");
    if (state.failRestore && state.updates.length > 0)
      return Promise.reject(new Error("Argo API returned HTTP 409"));
    state.updates.push(body);
    return Promise.resolve();
  },
  deleteArgoApplication: (
    name: string,
    input: { environmentId: string; cascade: boolean },
  ) => {
    state.events.push(`delete ${name} cascade=${String(input.cascade)}`);
    return Promise.resolve({ deleted: true });
  },
}));
vi.mock("#activities/delivery/argocd.ts", async (importOriginal) => {
  const original = await importOriginal<typeof Argocd>();
  return {
    ...original,
    argoRequest: () => Promise.resolve(null),
    runGuardedArgoCommand: (args: string[]) => {
      state.events.push(args[0] ?? "");
      return Promise.reject(
        new original.GuardedArgoCommandError(
          args[0] ?? "",
          1,
          "Refusing storm-forum sync because the read-only apply-safety preflight found:\n- batch/Job storm-forum/migrate changes immutable /spec/template",
        ),
      );
    },
  };
});
vi.mock("./stages.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Stages>()),
  recordStage: (
    _current: unknown,
    key: string,
    status: string,
    receipt: unknown,
  ) => {
    state.stages.push({ key, status, receipt });
    return Promise.resolve();
  },
}));
vi.mock("./forum-bundle.ts", () => ({
  forumBaselineFence: () => Promise.resolve(),
  forumSyncPrune: () => Promise.resolve(false),
}));

const { applySafety } = await import("./kubernetes.ts");

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

const synced = { chart: "storm-forum", targetRevision: "1.0.0" };

/** An existing Application whose last sync was `synced`. */
function existing(name: string) {
  return {
    metadata: { name, resourceVersion: "7" },
    spec: { source: synced },
    status: {
      history: [
        { id: 4, source: { chart: "storm-forum", targetRevision: "0.9.0" } },
        { id: 5, source: synced },
      ],
    },
  };
}

async function outcome(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("expected apply-safety to fail");
}

afterEach(() => {
  state.events = [];
  state.reads = [];
  state.updates = [];
  state.stages = [];
  state.failRestore = false;
});

describe("a refused apply-safety", () => {
  test("restores the source Argo last synced and settles a failed stage with the findings", async () => {
    const { current, recipe } = fixture();
    state.reads = [existing("storm-forum")];
    const error = await outcome(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({
      type: "DeliveryApplySafetyRefused",
      nonRetryable: true,
    });
    // The candidate body, then the restore of the latest history source.
    expect(state.updates).toHaveLength(2);
    expect(state.updates[1]).toMatchObject({
      metadata: { resourceVersion: "7" },
      spec: { source: synced },
    });
    expect(state.stages.map(({ status }) => status)).toEqual([
      "running",
      "failed",
    ]);
    expect(state.stages[1]?.receipt).toMatchObject({
      evidence: [
        {
          kind: "preflight",
          summary: expect.stringContaining("changes immutable /spec/template"),
        },
      ],
    });
  });

  test("removes an Application it created, without cascading", async () => {
    const { current, recipe } = fixture();
    state.reads = [null];
    const error = await outcome(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(error).toMatchObject({ type: "DeliveryApplySafetyRefused" });
    expect(state.events).toContain("create");
    expect(state.events.at(-1)).toMatch(/^delete .* cascade=false$/u);
    expect(state.stages.at(-1)?.status).toBe("failed");
  });

  test("keeps the stage running for recovery when the restore itself fails", async () => {
    const { current, recipe } = fixture();
    state.reads = [existing("storm-forum")];
    state.failRestore = true;
    const error = await outcome(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(error).not.toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({ name: "GuardedArgoCommandError" });
    expect(state.stages.map(({ status }) => status)).toEqual(["running"]);
  });
});
