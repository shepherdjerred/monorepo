import { afterEach, describe, expect, test, vi } from "vitest";
import { renderApplication } from "#lib/delivery/model/application.ts";
import { requireModelRecipe } from "#lib/delivery/model/recipe.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import {
  artifact,
  detail,
  recipe as arcadeRecipe,
} from "#lib/delivery/model/testing.ts";
import type * as Activity from "@temporalio/activity";
import type * as ArgoClient from "#lib/delivery/argo-client.ts";
import type * as Argocd from "#activities/delivery/argocd.ts";
import type * as Stages from "./stages.ts";

const calls = vi.hoisted(() => {
  const events: string[] = [];
  const reads: unknown[] = [];
  return { events, reads, lapsed: false };
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
vi.mock("#lib/delivery/argo-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ArgoClient>()),
  getArgoApplication: () => {
    calls.events.push("read");
    return Promise.resolve(
      calls.reads.length > 1 ? calls.reads.shift() : calls.reads[0],
    );
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
  requireOwned: () => Promise.resolve(arcade().current),
}));

const { sync } = await import("./kubernetes.ts");

/** arcade/prod's Helm Application, its sync step already running. */
function arcade() {
  const current = detail(
    arcadeRecipe(
      { repoURL: "https://chartmuseum.tailnet-1a49.ts.net", chart: "arcade" },
      "chart:arcade",
    ),
    artifact({
      id: "chart/1",
      component: "chart:arcade",
      kind: "chart",
      uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.0.1.tgz",
      version: "1.0.1",
      character: "b",
    }),
    [{ key: "step-sync", status: "running" }],
  );
  const recipe = requireModelRecipe(current);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("arcade deploys an Application");
  return { current, recipe };
}

/** The written Application, before and after this deployment's owned sync. */
function application(synced: boolean) {
  const { current, recipe } = arcade();
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
  calls.lapsed = false;
});

describe("a resumed sync step (D7)", () => {
  test("re-records its intent before the Argo sync", async () => {
    const { current, recipe } = arcade();
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(calls.events).toEqual([
      "read",
      "step-sync running",
      expect.stringMatching(/^sync-managed arcade /u),
      "read",
      "step-sync succeeded",
    ]);
  });

  test("whose lease lapsed is refused at its intent before any Argo sync", async () => {
    const { current, recipe } = arcade();
    calls.reads = [application(false)];
    calls.lapsed = true;
    await expect(sync(current, recipe, "step-sync")).rejects.toThrow(
      /lease lapsed/u,
    );
    expect(calls.events).toEqual(["read"]);
  });
});
