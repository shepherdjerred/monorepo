import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { requireModelRecipe } from "#lib/delivery/model/recipe.ts";
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
  return { events };
});
vi.mock("@temporalio/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof Activity>()),
  Context: {
    current: () => ({ cancellationSignal: new AbortController().signal }),
  },
}));
vi.mock("#lib/delivery/argo-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ArgoClient>()),
  getArgoApplication: () => Promise.resolve(null),
  createArgoApplication: () => {
    calls.events.push("create");
    return Promise.resolve();
  },
}));
vi.mock("#activities/delivery/argocd.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Argocd>()),
  runGuardedArgoCommand: (args: string[]) => {
    calls.events.push(args[0] ?? "");
    return Promise.resolve();
  },
}));
vi.mock("./stages.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Stages>()),
  recordStage: (_current: unknown, key: string, status: string) => {
    calls.events.push(`${key} ${status}`);
    return Promise.resolve();
  },
}));

const { verifyOciChart } = await import("./oci-chart.ts");
const { applySafety } = await import("./kubernetes.ts");

const CHART = "oci://registry.k8s.io/kueue/charts/kueue";
const MANIFEST_URL =
  "https://registry.k8s.io/v2/kueue/charts/kueue/manifests/0.13.4";

/** The Helm chart manifest a registry serves for a tag. */
function manifest(layer: string) {
  return new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 2,
      config: {
        mediaType: "application/vnd.cncf.helm.config.v1+json",
        digest: `sha256:${"1".repeat(64)}`,
        size: 1,
      },
      layers: [{ digest: `sha256:${layer.repeat(64)}`, size: 1 }],
    }),
  );
}

function sha256(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** What acquisition froze: tag 0.13.4 at the manifest whose only layer is `layer`. */
function frozen(layer: string) {
  return {
    id: "chart/kueue",
    uri: CHART,
    version: "0.13.4",
    digest: sha256(manifest(layer)),
  };
}

/** A registry whose tag 0.13.4 now serves the manifest with `layer`. */
function registry(layer: string, requested: string[]) {
  return (url: string | URL) => {
    requested.push(url.toString());
    return Promise.resolve(new Response(manifest(layer), { status: 200 }));
  };
}

/** kueue/prod's Application, its chart frozen at `layer`. */
function kueue(layer: string) {
  const chart = artifact({
    id: "chart/kueue",
    component: "chart:kueue",
    kind: "chart",
    uri: CHART,
    version: "0.13.4",
    character: "b",
  });
  const current = detail(
    arcadeRecipe(
      { repoURL: "registry.k8s.io/kueue/charts", chart: "kueue" },
      "chart:kueue",
    ),
    { ...chart, digest: frozen(layer).digest },
  );
  const recipe = requireModelRecipe(current);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("kueue deploys an Application");
  return { current, recipe };
}

afterEach(() => {
  calls.events = [];
  vi.unstubAllGlobals();
});

describe("an OCI chart's tag (T2)", () => {
  test("still resolving to the frozen manifest digest is evidence", async () => {
    const requested: string[] = [];
    await expect(
      verifyOciChart(
        frozen("a"),
        "operation",
        new AbortController().signal,
        registry("a", requested),
      ),
    ).resolves.toEqual({
      kind: "preflight",
      operationId: "operation",
      summary: `Source chart/kueue tag 0.13.4 still resolves to ${frozen("a").digest}`,
    });
    expect(requested).toEqual([MANIFEST_URL]);
  });

  test("moved to another manifest is refused", async () => {
    await expect(
      verifyOciChart(
        frozen("a"),
        "operation",
        new AbortController().signal,
        registry("c", []),
      ),
    ).rejects.toThrow(
      /now resolves to sha256:[a-f0-9]{64}, not the immutable/u,
    );
  });
});

describe("apply-safety of an OCI chart (T2)", () => {
  test("refuses a moved tag before its intent or any Application write", async () => {
    vi.stubGlobal("fetch", registry("c", []));
    const { current, recipe } = kueue("a");
    await expect(
      applySafety(current, recipe, "step-apply-safety"),
    ).rejects.toThrow(/not the immutable artifact digest/u);
    expect(calls.events).toEqual([]);
  });

  test("writes and proves the Application when the tag still resolves", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", registry("a", requested));
    const { current, recipe } = kueue("a");
    await applySafety(current, recipe, "step-apply-safety");
    expect(requested).toEqual([MANIFEST_URL]);
    expect(calls.events).toEqual([
      "step-apply-safety running",
      "create",
      "assert-apply-safe",
      "step-apply-safety succeeded",
    ]);
  });
});
