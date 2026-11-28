import { createHash } from "node:crypto";
import * as Timers from "node:timers/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { DeploymentDetailSchema } from "@shepherdjerred/delivery/contract";
import { deliveryOperationId } from "@shepherdjerred/delivery/operation-id";
import { argoApplication } from "#lib/delivery/model/step-testing.ts";
import { withLeaseLoss } from "#lib/delivery/model/effect-signal.ts";
import { forumDetail } from "#lib/delivery/model/forum-testing.ts";
import { artifact, detail } from "#lib/delivery/model/testing.ts";
import type * as Activity from "@temporalio/activity";
import type * as ArgoClient from "#lib/delivery/argo-client.ts";
import type * as Argocd from "#activities/delivery/argocd.ts";
import type * as Stages from "./stages.ts";
import {
  MEDIA_INGRESS_PRUNE_FLAG,
  MEDIA_INGRESS_PRUNE_INFO,
  mediaIngressSourceHash,
  type MediaIngressPruning,
} from "homelab/scripts/argocd/argocd-media-ingress-prunes.ts";

const calls = vi.hoisted(() => {
  const events: string[] = [];
  const reads: unknown[] = [];
  const updates: unknown[] = [];
  const stages: { key: string; status: string; receipt: unknown }[] = [];
  const argoResponses = new Map<string, unknown[]>();
  const hubReleases: unknown[] = [];
  const serviceProbesReleases: unknown[] = [];
  const clusterObservabilityReleases: unknown[] = [];
  const credentialDecision: { credentialPrune: boolean | MediaIngressPruning } =
    { credentialPrune: false };
  return {
    events,
    reads,
    updates,
    stages,
    argoResponses,
    prune: false,
    ...credentialDecision,
    credentialFailure: false,
    hubPrune: false,
    hubReleases,
    serviceProbesPrune: false,
    serviceProbesReleases,
    clusterObservabilityPrune: false,
    clusterObservabilityReleases,
    lapsed: false,
    refuse: false,
    failSync: "",
    failCreate: false,
    failUpdate: false,
    failRestore: false,
  };
});
vi.mock("node:timers/promises", async (original) => {
  const timers = await original<typeof Timers>();
  return { ...timers, setTimeout: vi.fn(timers.setTimeout) };
});
vi.mock("@temporalio/activity", async (importOriginal) => {
  const { mockActivityModule } =
    await import("#lib/delivery/model/step-testing.ts");
  return await mockActivityModule(importOriginal<typeof Activity>);
});
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
    return calls.failCreate
      ? Promise.reject(new Error("Argo API returned HTTP 400"))
      : Promise.resolve();
  },
  updateArgoApplication: (_name: string, body: unknown) => {
    calls.events.push("update");
    if (calls.failUpdate)
      return Promise.reject(new Error("Argo API returned HTTP 400"));
    if (calls.failRestore && calls.updates.length > 0)
      return Promise.reject(new Error("Argo API returned HTTP 409"));
    calls.updates.push(body);
    return Promise.resolve();
  },
  deleteArgoApplication: (_name: string, input: { cascade: boolean }) => {
    calls.events.push(`delete cascade=${String(input.cascade)}`);
    return Promise.resolve({ deleted: true });
  },
}));
vi.mock("#activities/delivery/argocd.ts", async (importOriginal) => {
  const original = await importOriginal<typeof Argocd>();
  return {
    ...original,
    argoRequest: (path: string) => {
      const replies = calls.argoResponses.get(path);
      if (replies === undefined) return Promise.resolve(null);
      calls.events.push(path);
      return Promise.resolve(replies.shift());
    },
    runGuardedArgoCommand: (args: string[]) => {
      calls.events.push(args.join(" "));
      if (calls.failSync !== "" && args[0] === "sync-managed")
        return Promise.reject(
          new original.GuardedArgoCommandError(
            "sync-managed",
            1,
            calls.failSync,
          ),
        );
      return calls.refuse && args[0] === "assert-apply-safe"
        ? Promise.reject(
            new original.GuardedArgoCommandError(
              "assert-apply-safe",
              1,
              "Refusing storm-forum sync because the read-only apply-safety preflight found:\n- batch/Job storm-forum/migrate changes immutable /spec/template",
            ),
          )
        : Promise.resolve();
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
    calls.stages.push({ key, status, receipt });
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
vi.mock("#lib/delivery/credential-prune.ts", () => ({
  credentialSyncPrunes: () => {
    if (calls.credentialFailure)
      throw new Error("Credential retirement proof failed");
    return Promise.resolve(calls.credentialPrune);
  },
}));

vi.mock("#lib/delivery/alert-dashboard/prune.ts", () => ({
  alertDashboardSyncPrunes: (release: unknown) => {
    calls.hubReleases.push(release);
    return Promise.resolve(calls.hubPrune);
  },
}));

vi.mock("#lib/delivery/service-probes/prune.ts", () => ({
  serviceProbesSyncPrunes: (release: unknown) => {
    calls.serviceProbesReleases.push(release);
    return Promise.resolve(calls.serviceProbesPrune);
  },
}));

vi.mock("#lib/delivery/cluster-observability/prune.ts", () => ({
  clusterObservabilitySyncPrunes: (release: unknown) => {
    calls.clusterObservabilityReleases.push(release);
    return Promise.resolve(calls.clusterObservabilityPrune);
  },
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
  calls.credentialPrune = false;
  calls.credentialFailure = false;
  calls.hubPrune = false;
  calls.hubReleases = [];
  calls.serviceProbesPrune = false;
  calls.serviceProbesReleases = [];
  calls.clusterObservabilityPrune = false;
  calls.clusterObservabilityReleases = [];
  calls.argoResponses.clear();
  calls.lapsed = false;
  calls.updates = [];
  calls.stages = [];
  calls.refuse = false;
  calls.failSync = "";
  calls.failCreate = false;
  calls.failUpdate = false;
  calls.failRestore = false;
});

const CHART_REGISTRY = "https://charts.tailnet-1a49.ts.net";
const LEGACY_CHART_REGISTRY = "https://chartmuseum.sjer.red";
const CHART_VERSION = "5.4.0";
const CHART_PATH = `/charts/minecraft-${CHART_VERSION}.tgz`;
const PUBLISHER_REPO = "https://itzg.github.io/minecraft-server-charts/";
const CHART_CONTENT = "upstream Minecraft chart";
const CHART_DIGEST = `sha256:${createHash("sha256").update(CHART_CONTENT).digest("hex")}`;

function minecraftFixture(
  uri: string,
  repoURL = CHART_REGISTRY,
  upstream = PUBLISHER_REPO,
) {
  const chart = {
    ...artifact({
      id: "chart/minecraft",
      component: "chart:minecraft",
      kind: "chart",
      uri,
      version: CHART_VERSION,
      character: "a",
    }),
    serviceId: "minecraft",
    digest: CHART_DIGEST,
    origin: {
      kind: "upstream",
      repository: upstream,
      name: "minecraft",
      version: CHART_VERSION,
      checksum: CHART_DIGEST,
    },
  };
  const instance = "application:minecraft-tsmc";
  const definition = {
    kind: "kubernetes-application",
    application: {
      name: "minecraft-tsmc",
      project: "default",
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "minecraft-tsmc",
      },
      source: { repoURL, chart: "minecraft" },
      lifecycle: "retain",
    },
    chartComponent: "chart:minecraft",
    runner: { service: "ci", component: "image:ci-base" },
    steps: [
      { kind: "apply-safety", instance },
      { kind: "sync", instance },
    ],
    oracle: { probes: [], tests: [] },
  };
  const base = detail(definition, chart);
  const current = DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      serviceId: "minecraft",
      environmentId: "minecraft/tsmc",
    },
    versionSet: { ...base.versionSet, serviceId: "minecraft" },
  });
  const recipe = current.pipeline.definition;
  if (recipe.kind !== "kubernetes-application")
    throw new Error("Minecraft fixture requires a Kubernetes Application");
  return { current, recipe };
}

describe("Minecraft chart apply-safety", () => {
  const retryWait = vi.mocked(Timers.setTimeout);
  afterEach(() => {
    retryWait.mockReset();
    vi.unstubAllGlobals();
  });

  test.each([
    {
      uri: `${LEGACY_CHART_REGISTRY}${CHART_PATH}`,
      requestedUri: `${CHART_REGISTRY}${CHART_PATH}`,
      redirect: "error",
    },
    {
      uri: `https://chartmuseum.tailnet-1a49.ts.net${CHART_PATH}`,
      requestedUri: `${CHART_REGISTRY}${CHART_PATH}`,
      redirect: "error",
    },
    {
      uri: `${CHART_REGISTRY}${CHART_PATH}`,
      requestedUri: `${CHART_REGISTRY}${CHART_PATH}`,
      redirect: "follow",
    },
    {
      uri: `${PUBLISHER_REPO}minecraft-${CHART_VERSION}.tgz`,
      requestedUri: `${PUBLISHER_REPO}minecraft-${CHART_VERSION}.tgz`,
      redirect: "follow",
    },
  ])(
    "verifies the frozen bytes for $uri",
    async ({ uri, requestedUri, redirect }) => {
      const { current, recipe } = minecraftFixture(uri);
      const download = vi.fn().mockResolvedValue(new Response(CHART_CONTENT));
      vi.stubGlobal("fetch", download);
      calls.reads = [null];

      await applySafety(current, recipe, "step-apply-safety");

      expect(download).toHaveBeenCalledExactlyOnceWith(
        requestedUri,
        expect.objectContaining({ redirect }),
      );
      expect(calls.events).toContain(
        `assert-apply-safe minecraft-tsmc --revision ${CHART_VERSION}`,
      );
      expect(calls.stages.at(-1)?.receipt).toMatchObject({
        evidence: [
          { summary: expect.stringContaining(`bytes match ${CHART_DIGEST}`) },
          { kind: "preflight" },
        ],
      });
      expect(current.versionSet.components["chart:minecraft"]?.uri).toBe(uri);
    },
  );

  test.each([502, 503, 504])(
    "retries HTTP %i only on the exact pinned chart GET",
    async (status) => {
      const { current, recipe } = minecraftFixture(
        `${LEGACY_CHART_REGISTRY}${CHART_PATH}`,
      );
      const download = vi
        .fn()
        .mockResolvedValueOnce(new Response("gateway unavailable", { status }))
        .mockResolvedValueOnce(new Response(CHART_CONTENT));
      vi.stubGlobal("fetch", download);
      retryWait.mockResolvedValueOnce(undefined);
      calls.reads = [null];

      await applySafety(current, recipe, "step-apply-safety");

      const uri = `${CHART_REGISTRY}${CHART_PATH}`;
      const options = expect.objectContaining({
        method: "GET",
        redirect: "error",
      });
      expect(download.mock.calls).toEqual([
        [uri, options],
        [uri, options],
      ]);
      expect(retryWait).toHaveBeenCalledExactlyOnceWith(5000, undefined, {
        signal: expect.any(AbortSignal),
      });
      expect(calls.stages.at(-1)?.receipt).toMatchObject({
        evidence: [
          { summary: expect.stringContaining(`bytes match ${CHART_DIGEST}`) },
          { kind: "preflight" },
        ],
      });
    },
  );

  test("bounds repeated chart gateway failures before any stage or Argo write", async () => {
    const { current, recipe } = minecraftFixture(
      `${CHART_REGISTRY}${CHART_PATH}`,
    );
    const download = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 502 })),
    );
    vi.stubGlobal("fetch", download);
    retryWait.mockResolvedValue(undefined);

    await expect(
      applySafety(current, recipe, "step-apply-safety"),
    ).rejects.toThrow("Source inspection returned HTTP 502");

    expect(download).toHaveBeenCalledTimes(4);
    expect(retryWait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      5000, 10_000, 20_000,
    ]);
    expect(calls.events).toEqual([]);
    expect(calls.stages).toEqual([]);
  });

  test.each([401, 403, 404, 500])(
    "refuses chart HTTP %i before retry or writes",
    async (status) => {
      const { current, recipe } = minecraftFixture(
        `${CHART_REGISTRY}${CHART_PATH}`,
      );
      const download = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status }));
      vi.stubGlobal("fetch", download);

      await expect(
        applySafety(current, recipe, "step-apply-safety"),
      ).rejects.toThrow(`Source inspection returned HTTP ${status.toString()}`);

      expect(download).toHaveBeenCalledTimes(1);
      expect(retryWait).not.toHaveBeenCalled();
      expect(calls.events).toEqual([]);
      expect(calls.stages).toEqual([]);
    },
  );

  test("lease loss cancels chart retry backoff before stage or Argo writes", async () => {
    const { current, recipe } = minecraftFixture(
      `${CHART_REGISTRY}${CHART_PATH}`,
    );
    const download = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 502 }));
    vi.stubGlobal("fetch", download);
    const lost = new AbortController();
    const waiting = Promise.withResolvers<undefined>();
    const timers = await vi.importActual<typeof Timers>("node:timers/promises");
    retryWait.mockImplementationOnce((milliseconds, value, options) => {
      waiting.resolve(undefined);
      return timers.setTimeout(milliseconds, value, options);
    });

    const outcome = expect(
      withLeaseLoss(
        lost.signal,
        async () => await applySafety(current, recipe, "step-apply-safety"),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    await waiting.promise;
    lost.abort();
    await outcome;

    expect(download).toHaveBeenCalledTimes(1);
    expect(calls.events).toEqual([]);
    expect(calls.stages).toEqual([]);
  });

  test("refuses changed bytes from the replacement mirror before writing anything", async () => {
    const { current, recipe } = minecraftFixture(
      `${LEGACY_CHART_REGISTRY}${CHART_PATH}`,
    );
    const download = vi.fn().mockResolvedValue(new Response("changed bytes"));
    vi.stubGlobal("fetch", download);

    await expect(
      applySafety(current, recipe, "step-apply-safety"),
    ).rejects.toThrow(
      "Published source bytes differ from the immutable artifact digest",
    );
    expect(download).toHaveBeenCalledExactlyOnceWith(
      `${CHART_REGISTRY}${CHART_PATH}`,
      expect.objectContaining({ redirect: "error" }),
    );
    expect(retryWait).not.toHaveBeenCalled();
    expect(calls.events).toEqual([]);
    expect(calls.stages).toEqual([]);
  });

  test.each([
    { uri: `${LEGACY_CHART_REGISTRY}/charts/minecraft-5.3.0.tgz` },
    { uri: `${LEGACY_CHART_REGISTRY}/other/minecraft-${CHART_VERSION}.tgz` },
    { uri: `${LEGACY_CHART_REGISTRY}${CHART_PATH}?download=1` },
    { uri: `${LEGACY_CHART_REGISTRY}${CHART_PATH}`, repoURL: PUBLISHER_REPO },
    { uri: `${LEGACY_CHART_REGISTRY}${CHART_PATH}`, upstream: CHART_REGISTRY },
  ])(
    "refuses an unbound historical chart URI ($uri)",
    async ({ uri, repoURL, upstream }) => {
      const { current, recipe } = minecraftFixture(uri, repoURL, upstream);
      const download = vi.fn();
      vi.stubGlobal("fetch", download);

      await expect(
        applySafety(current, recipe, "step-apply-safety"),
      ).rejects.toThrow(
        "Historical ChartMuseum URI does not match the selected upstream Minecraft chart and its canonical Charts recipe",
      );
      expect(download).not.toHaveBeenCalled();
      expect(calls.events).toEqual([]);
      expect(calls.stages).toEqual([]);
    },
  );
});

function mediaRetirementFixture() {
  const initial = fixture();
  const current = {
    ...initial.current,
    deployment: {
      ...initial.current.deployment,
      environmentId: "streambot/prod",
    },
  };
  const recipe = {
    ...initial.recipe,
    application: {
      ...initial.recipe.application,
      name: "media",
      destination: {
        ...initial.recipe.application.destination,
        namespace: "media",
      },
      source: { ...initial.recipe.application.source, chart: "media" },
    },
    steps: initial.recipe.steps.filter(({ kind }) => kind !== "forum-bundle"),
  };
  const before = argoApplication(current, recipe, false);
  const after = argoApplication(current, recipe, true);
  const state = after.status.operationState;
  if (state === undefined) throw new Error("Synced fixture lost its operation");
  const ingress: MediaIngressPruning["resources"][number] = {
    group: "networking.k8s.io",
    kind: "Ingress",
    namespace: "media",
    name: "media-bazarr-tailscale-ingress-ingress",
    uid: "uid-bazarr",
  };
  const proof: MediaIngressPruning = {
    applicationUid: after.metadata.uid,
    sourceHash: mediaIngressSourceHash(after.spec.source),
    resources: [ingress],
  };
  state.operation.info.push({
    name: MEDIA_INGRESS_PRUNE_INFO,
    value: JSON.stringify(proof),
  });
  return {
    current,
    recipe,
    before,
    after,
    operation: state.operation,
    proof,
    ingress,
  };
}

describe("Media ingress retirement", () => {
  test("passes the reviewed candidates to guarded sync and verifies actual absence", async () => {
    const f = mediaRetirementFixture();
    calls.credentialPrune = f.proof;
    calls.reads = [f.before, f.after];
    calls.argoResponses.set("media?refresh=hard", [f.after]);
    calls.argoResponses.set("media/managed-resources", [{ items: [] }]);
    await sync(f.current, f.recipe, "step-sync");
    expect(
      calls.events.find((event) => event.startsWith("sync-managed")),
    ).toContain(`${MEDIA_INGRESS_PRUNE_FLAG} ${JSON.stringify(f.proof)}`);
    expect(calls.events.slice(-3)).toEqual([
      "media?refresh=hard",
      "media/managed-resources",
      "step-sync succeeded",
    ]);
  });

  test("a resumed Media sync polls through lingering ingress finalizers without starting another sync", async () => {
    const f = mediaRetirementFixture();
    const sleep = vi.spyOn(Bun, "sleep").mockResolvedValue();
    try {
      const pending = {
        ...f.after,
        status: {
          ...f.after.status,
          sync: {
            status: "OutOfSync",
            revision: f.after.spec.source.targetRevision,
          },
          resources: [
            { ...f.ingress, status: "OutOfSync", requiresPruning: true },
          ],
        },
      };
      calls.reads = [
        { ...f.before, operation: f.operation },
        pending,
        f.after,
        f.after,
      ];
      calls.argoResponses.set("media?refresh=hard", [f.after, f.after]);
      calls.argoResponses.set("media/managed-resources", [
        {
          items: [
            {
              ...f.ingress,
              liveState: JSON.stringify({
                metadata: { deletionTimestamp: "2026-11-21T14:00:00Z" },
              }),
            },
          ],
        },
        { items: [] },
      ]);
      await sync(f.current, f.recipe, "step-sync");
      expect(
        calls.events.filter((event) => event.startsWith("sync-managed")),
      ).toEqual([]);
      expect(
        calls.events.filter((event) => event === "media/managed-resources"),
      ).toHaveLength(2);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(calls.events.at(-1)).toBe("step-sync succeeded");
    } finally {
      sleep.mockRestore();
    }
  });
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

  test("the credential guard authorizes pruning through the owned sync", async () => {
    const { current, recipe } = fixture();
    calls.credentialPrune = true;
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(
      calls.events.find((event) => event.startsWith("sync-managed")),
    ).toContain("--prune");
    expect(calls.events.indexOf("step-sync running")).toBeLessThan(
      calls.events.findIndex((event) => event.startsWith("sync-managed")),
    );
  });

  test("the Hub route guard authorizes pruning for the rendered release", async () => {
    const { current, recipe } = fixture();
    calls.hubPrune = true;
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(
      calls.events.find((event) => event.startsWith("sync-managed")),
    ).toContain("--prune");
    expect(calls.hubReleases).toEqual([
      expect.objectContaining({
        application: "storm-forum",
        chart: "storm-forum",
        namespace: "storm-forum",
        environmentId: "storm-forum/prod",
        revision: "1.0.1",
      }),
    ]);
  });

  test("the Hub route guard is not consulted once another guard prunes", async () => {
    const { current, recipe } = fixture();
    calls.credentialPrune = true;
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(calls.hubReleases).toEqual([]);
    expect(calls.serviceProbesReleases).toEqual([]);
  });

  test("the service-probes guard authorizes pruning for the rendered release", async () => {
    const { current, recipe } = fixture();
    calls.serviceProbesPrune = true;
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(
      calls.events.find((event) => event.startsWith("sync-managed")),
    ).toContain("--prune");
    expect(calls.serviceProbesReleases).toEqual([
      expect.objectContaining({
        application: "storm-forum",
        chart: "storm-forum",
        namespace: "storm-forum",
        environmentId: "storm-forum/prod",
        revision: "1.0.1",
      }),
    ]);
  });

  test("the service-probes guard is not consulted once Hub prunes", async () => {
    const { current, recipe } = fixture();
    calls.hubPrune = true;
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(calls.serviceProbesReleases).toEqual([]);
  });

  test("failed credential proof prevents the native sync", async () => {
    const { current, recipe } = fixture();
    calls.credentialFailure = true;
    calls.reads = [application(false)];
    await expect(sync(current, recipe, "step-sync")).rejects.toThrow(
      "Credential retirement proof failed",
    );
    // No synced history: the step cannot prove what apply-safety replaced,
    // so the stage stays running for recovery (D5).
    expect(calls.events).toEqual(["read", "step-sync running", "read"]);
    expect(calls.updates).toEqual([]);
  });

  test("a sync settled only by prune-pending resources records bounded evidence the API accepts", async () => {
    const { current, recipe } = fixture();
    const synced = application(true);
    if (!("operationState" in synced.status))
      throw new Error("Synced fixture lost its status");
    const names = Array.from(
      { length: 120 },
      (_, index) =>
        `temporal-delivery-wf-retained-${String(index).padStart(12, "0")}`,
    );
    const settled = {
      ...synced,
      status: {
        ...synced.status,
        sync: { ...synced.status.sync, status: "OutOfSync" },
        resources: names.map((name) => ({
          group: "apps",
          kind: "Deployment",
          namespace: "temporal",
          name,
          status: "OutOfSync",
          requiresPruning: true,
        })),
      },
    };
    calls.reads = [application(false), settled];
    await sync(current, recipe, "step-sync");
    const succeeded = calls.stages.find(({ status }) => status === "succeeded");
    if (succeeded === undefined) throw new Error("Sync stage never succeeded");
    const receipt: unknown = succeeded.receipt;
    if (
      typeof receipt !== "object" ||
      receipt === null ||
      !("evidence" in receipt) ||
      !Array.isArray(receipt.evidence)
    )
      throw new Error("Sync stage recorded no evidence");
    const evidence: { kind: string; summary: string }[] = receipt.evidence;
    // The Delivery API caps an evidence summary at 4000 chars (AI-794): the
    // full prune-pending list must be chunked, never one oversized summary.
    expect(evidence.length).toBeGreaterThan(1);
    for (const item of evidence) {
      expect(item.kind).toBe("reconciliation");
      expect(item.summary.length).toBeLessThanOrEqual(4000);
    }
    const joined = evidence.map((item) => item.summary).join("\n");
    for (const name of names) expect(joined).toContain(name);
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

/** An existing Application whose last sync was `synced`. */
const synced = { chart: "storm-forum", targetRevision: "1.0.0" };
function existingApplication() {
  return {
    metadata: { name: "storm-forum", resourceVersion: "7" },
    spec: { source: synced },
    status: {
      history: [
        { id: 4, source: { chart: "storm-forum", targetRevision: "0.9.0" } },
        { id: 5, source: synced },
      ],
    },
  };
}

async function refusal(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("expected apply-safety to fail");
}

/**
 * temporal/prod c0025f42 (2026-11-07): assert-apply-safe refused after the
 * candidate body was written, the stage stayed running, and the stale body
 * stalled the next release. A refusal now undoes the write and settles.
 */
describe("a refused apply-safety", () => {
  test("restores the source Argo last synced and settles a failed stage with the findings", async () => {
    const { current, recipe } = fixture();
    calls.reads = [existingApplication()];
    calls.refuse = true;
    const error = await refusal(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({
      type: "DeliveryApplySafetyRefused",
      nonRetryable: true,
    });
    // The candidate body, then the restore of the latest history source.
    expect(calls.updates).toHaveLength(2);
    expect(calls.updates[1]).toMatchObject({
      metadata: { resourceVersion: "7" },
      spec: { source: synced },
    });
    expect(calls.stages.map(({ status }) => status)).toEqual([
      "running",
      "failed",
    ]);
    expect(calls.stages[1]?.receipt).toMatchObject({
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
    calls.reads = [null];
    calls.refuse = true;
    const error = await refusal(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(error).toMatchObject({ type: "DeliveryApplySafetyRefused" });
    expect(calls.events).toContain("write");
    // The write is undone before the stage settles.
    expect(calls.events.slice(-2)).toEqual([
      "delete cascade=false",
      "step-apply-safety failed",
    ]);
    expect(calls.stages.at(-1)?.status).toBe("failed");
  });

  test("keeps the stage running for recovery when the restore itself fails", async () => {
    const { current, recipe } = fixture();
    calls.reads = [existingApplication()];
    calls.refuse = true;
    calls.failRestore = true;
    const error = await refusal(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(error).not.toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({ name: "GuardedArgoCommandError" });
    expect(calls.stages.map(({ status }) => status)).toEqual(["running"]);
  });
});

describe("a failed apply-safety body write (AI-423)", () => {
  test("settles failed stage when writeBody throws without mutating spec.source or creating the Application", async () => {
    const { current, recipe } = fixture();
    calls.reads = [existingApplication(), existingApplication()];
    calls.failUpdate = true;
    const updateError = await refusal(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(updateError).toBeInstanceOf(ApplicationFailure);
    expect(updateError).toMatchObject({
      type: "DeliveryApplySafetyRefused",
      nonRetryable: true,
    });
    expect(calls.stages.map(({ status }) => status)).toEqual([
      "running",
      "failed",
    ]);
    expect(calls.stages[1]?.receipt).toMatchObject({
      evidence: [
        {
          kind: "preflight",
          summary: expect.stringContaining("Argo API returned HTTP 400"),
        },
      ],
    });

    calls.stages = [];
    calls.events = [];
    calls.failUpdate = false;
    calls.failCreate = true;
    calls.reads = [null, null];
    const createError = await refusal(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(createError).toMatchObject({
      type: "DeliveryApplySafetyRefused",
      nonRetryable: true,
    });
    expect(calls.stages.map(({ status }) => status)).toEqual([
      "running",
      "failed",
    ]);
  });

  test("retains recovery ownership when writeBody fails and readback observes mutated spec, metadata, unsettled operation, or vanished Application", async () => {
    const { current, recipe } = fixture();
    const priorWithSelfHeal = {
      ...existingApplication(),
      metadata: {
        ...existingApplication().metadata,
        annotations: {
          "delivery.shepherdjerred.com/environment": "forum/prod",
        },
      },
      spec: {
        ...existingApplication().spec,
        syncPolicy: {
          automated: { enabled: true, selfHeal: true, prune: false },
        },
      },
    };
    for (const afterRead of [
      {
        ...priorWithSelfHeal,
        spec: { source: { chart: "storm-forum", targetRevision: "1.0.1" } },
      },
      {
        // Same synced source, but full-body PUT replaced syncPolicy (disabled selfHeal).
        ...priorWithSelfHeal,
        metadata: { ...priorWithSelfHeal.metadata, resourceVersion: "8" },
        spec: {
          ...priorWithSelfHeal.spec,
          syncPolicy: { automated: { enabled: false } },
        },
      },
      {
        ...priorWithSelfHeal,
        metadata: {
          ...priorWithSelfHeal.metadata,
          annotations: { "argocd.argoproj.io/sync-options": "Prune=false" },
        },
      },
      {
        ...priorWithSelfHeal,
        status: {
          ...priorWithSelfHeal.status,
          operationState: { phase: "Running" },
        },
      },
      null,
    ]) {
      calls.stages = [];
      calls.failUpdate = true;
      calls.reads = [priorWithSelfHeal, afterRead];
      const error = await refusal(
        applySafety(current, recipe, "step-apply-safety"),
      );
      expect(error).not.toBeInstanceOf(ApplicationFailure);
      expect(calls.stages.map(({ status }) => status)).toEqual(["running"]);
    }
  });
});

/** The written body, its last operation another request's, with a synced history. */
function refusedApplication(requestId: string) {
  const written = application(false);
  return {
    ...written,
    metadata: { ...written.metadata, resourceVersion: "41" },
    status: {
      operationState: {
        phase: "Succeeded",
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: requestId },
            { name: "ci.sjer.red/operation-id", value: "operation-0" },
          ],
        },
      },
      history: [
        {
          id: 7,
          source: { ...written.spec.source, targetRevision: "1.0.0" },
        },
      ],
    },
  };
}

describe("a pre-sync guard refusal (AI-884)", () => {
  test("a guard refusal before any operation undoes the written body and settles the stage failed (AI-884)", async () => {
    const { current, recipe } = fixture();
    calls.credentialFailure = true;
    calls.reads = [refusedApplication("prior-request")];
    const failure = await sync(current, recipe, "step-sync").catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect(failure).toMatchObject({
      type: "DeliverySyncGuardRefused",
      nonRetryable: true,
    });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toMatchObject({
      spec: { source: { targetRevision: "1.0.0" } },
    });
    expect(calls.stages.map(({ key, status }) => `${key} ${status}`)).toEqual([
      "step-sync running",
      "step-sync failed",
    ]);
    expect(JSON.stringify(calls.stages.at(-1)?.receipt)).toContain(
      "never reached Argo",
    );
    expect(calls.events).not.toContain(expect.stringContaining("sync-managed"));
  });

  test("a guard refusal stays recovery-required while an operation is pending", async () => {
    const { current, recipe } = fixture();
    calls.credentialFailure = true;
    calls.reads = [
      { ...refusedApplication("prior-request"), operation: { sync: {} } },
    ];
    await expect(sync(current, recipe, "step-sync")).rejects.toThrow(
      "Credential retirement proof failed",
    );
    expect(calls.updates).toEqual([]);
    expect(calls.stages.map(({ status }) => status)).toEqual(["running"]);
  });

  test("a guard refusal stays recovery-required when undoing the body fails", async () => {
    const { current, recipe } = fixture();
    calls.credentialFailure = true;
    calls.failUpdate = true;
    calls.reads = [refusedApplication("prior-request")];
    await expect(sync(current, recipe, "step-sync")).rejects.toThrow(
      "Credential retirement proof failed",
    );
    expect(calls.stages.map(({ status }) => status)).toEqual(["running"]);
  });
});

describe("a failed Argo comparison before the prune guards", () => {
  test("refuses media's 2.0.0-1019523 ComparisonError before any guard reads managed resources", async () => {
    const { current, recipe } = fixture();
    const refused = refusedApplication("prior-request");
    calls.reads = [
      {
        ...refused,
        status: {
          ...refused.status,
          sync: { status: "Unknown" },
          conditions: [
            {
              type: "ComparisonError",
              message:
                'Deployment.apps "media-qbittorrent" is invalid: spec.template.spec.initContainers[1].name: Duplicate value: "gluetun"',
            },
          ],
        },
      },
    ];
    const failure = await sync(current, recipe, "step-sync").catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      type: "DeliverySyncGuardRefused",
      nonRetryable: true,
    });
    expect(JSON.stringify(calls.stages.at(-1)?.receipt)).toContain(
      "until Argo completes its comparison",
    );
    expect(calls.events).not.toContain(
      expect.stringContaining("managed-resources"),
    );
    expect(calls.events).not.toContain(expect.stringContaining("sync-managed"));
  });
});

describe("Scout child sync timeout floor (AI-658)", () => {
  test.each([
    ["scout-beta", "scout-for-lol/beta", "2700"],
    ["scout-prod", "scout-for-lol/prod", "2700"],
    ["storm-forum", "storm-forum/prod", "1200"],
  ] as const)(
    "sync-managed uses childSyncTimeoutSeconds floor for %s",
    async (appName, environmentId, expectedTimeout) => {
      const initial = fixture();
      const current = {
        ...initial.current,
        deployment: {
          ...initial.current.deployment,
          environmentId,
        },
      };
      const recipe = {
        ...initial.recipe,
        application: {
          ...initial.recipe.application,
          name: appName,
          destination: {
            ...initial.recipe.application.destination,
            namespace: appName,
          },
          source: { ...initial.recipe.application.source, chart: appName },
        },
        steps: initial.recipe.steps.filter(
          ({ kind }) => kind !== "forum-bundle",
        ),
      };
      calls.reads = [
        argoApplication(current, recipe, false),
        argoApplication(current, recipe, true),
      ];
      await sync(current, recipe, "step-sync");
      expect(
        calls.events.find((event) => event.startsWith("sync-managed")),
      ).toBe(
        [
          `sync-managed ${appName} --revision 1.0.1 --request-id`,
          deliveryOperationId(current.deployment.id),
          `--timeout ${expectedTimeout}`,
        ].join(" "),
      );
    },
  );

  test("a timed-out Scout sync keeps its stage running for recovery after guarded sync exits", async () => {
    const initial = fixture();
    const current = {
      ...initial.current,
      deployment: {
        ...initial.current.deployment,
        environmentId: "scout-for-lol/prod",
      },
    };
    const recipe = {
      ...initial.recipe,
      application: {
        ...initial.recipe.application,
        name: "scout-prod",
        destination: {
          ...initial.recipe.application.destination,
          namespace: "scout-prod",
        },
        source: { ...initial.recipe.application.source, chart: "scout-prod" },
      },
      steps: initial.recipe.steps.filter(({ kind }) => kind !== "forum-bundle"),
    };
    calls.reads = [argoApplication(current, recipe, false)];
    calls.failSync =
      "Timeout: sync operation for scout-prod did not complete within 2700s";
    await expect(sync(current, recipe, "step-sync")).rejects.toMatchObject({
      name: "GuardedArgoCommandError",
      output:
        "Timeout: sync operation for scout-prod did not complete within 2700s",
    });
    expect(calls.stages.map(({ status }) => status)).toEqual(["running"]);
  });
});

describe("cluster-observability prune guard (AI-908)", () => {
  test("the cluster-observability guard authorizes pruning when earlier guards do not", async () => {
    const { current, recipe } = fixture();
    calls.clusterObservabilityPrune = true;
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(
      calls.events.find((event) => event.startsWith("sync-managed")),
    ).toContain("--prune");
    expect(calls.clusterObservabilityReleases).toEqual([
      expect.objectContaining({
        application: "storm-forum",
        chart: "storm-forum",
        namespace: "storm-forum",
        environmentId: "storm-forum/prod",
        revision: "1.0.1",
      }),
    ]);
  });
});

describe("tracked worker compatibility (AI-833)", () => {
  test("apply-safety refuses an incompatible chart:media and tracked worker before writeBody (AI-833)", async () => {
    const { requireModelRecipe } =
      await import("#lib/delivery/model/recipe.ts");
    const { buildChartTgz } = await import("#lib/delivery/model/testing.ts");
    const chartBytes = buildChartTgz([
      {
        path: "media/templates/media.k8s.yaml",
        content: [
          "apiVersion: apps/v1",
          "kind: Deployment",
          "metadata:",
          "  name: media-files",
          "spec:",
          "  template:",
          "    spec:",
          "      containers:",
          "        - name: media-files",
          '          image: \'{{ required `Delivery requires image:temporal-worker` (get (get (.Values.delivery | default dict) "dependencies" | default dict) "temporal-worker") }}\'',
          "          env:",
          "            - name: FEATURE_FLAGS_MODE",
          "              value: flags",
        ].join("\n"),
      },
    ]);
    const chartDigest = `sha256:${createHash("sha256").update(chartBytes).digest("hex")}`;
    const chartUrl =
      "https://chartmuseum.tailnet-1a49.ts.net/charts/media-2.0.0-1018413.tgz";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(new Uint8Array(chartBytes), { status: 200 }),
      );
    try {
      const initial = fixture();
      const mediaRecipe = {
        ...initial.recipe,
        application: {
          ...initial.recipe.application,
          name: "media",
          destination: {
            ...initial.recipe.application.destination,
            namespace: "media",
          },
          source: {
            repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
            chart: "media",
          },
        },
        chartComponent: "chart:media",
        artifactParameters: {
          "delivery.dependencies.temporal-worker": {
            component: "image:temporal-worker",
            format: "reference" as const,
          },
        },
        steps: initial.recipe.steps
          .filter(({ kind }) => kind !== "forum-bundle")
          .map((step) => ({ ...step, instance: "application:media" })),
      };
      const makeMediaDetail = (workerVersion: string, workerSha: string) =>
        DeploymentDetailSchema.parse({
          ...initial.current,
          deployment: {
            ...initial.current.deployment,
            serviceId: "streambot",
            environmentId: "streambot/prod",
          },
          pipeline: { ...initial.current.pipeline, definition: mediaRecipe },
          versionSet: {
            ...initial.current.versionSet,
            serviceId: "streambot",
            components: {
              "chart:media": {
                ...artifact({
                  id: "ci/1/18413/chart/media",
                  component: "chart:media",
                  kind: "chart",
                  uri: chartUrl,
                  version: "2.0.0-1018413",
                  character: "a",
                }),
                digest: chartDigest,
                serviceId: "streambot",
                sourceRevision: "f545a3b02ffcb3a2545ae038bc2dc58e499a0c6f",
              },
              "image:temporal-worker": {
                ...artifact({
                  id: "ci/1/18391/image/temporal-worker",
                  component: "image:temporal-worker",
                  kind: "image",
                  uri: "docker.io/shepherdjerred/temporal-worker",
                  version: workerVersion,
                  character: "b",
                }),
                serviceId: "temporal",
                sourceRevision: workerSha,
              },
            },
          },
        });
      const incompatible = makeMediaDetail(
        "2.0.0-1018391",
        "63cf013a6ae11ac0e6fd544d7d5aa95945b54c61",
      );
      const parsedRecipe = requireModelRecipe(incompatible);
      if (parsedRecipe.kind !== "kubernetes-application")
        throw new Error("Expected kubernetes-application");
      const error = await refusal(
        applySafety(incompatible, parsedRecipe, "step-apply-safety"),
      );
      expect(error).toMatchObject({
        type: "DeliveryApplySafetyRefused",
        nonRetryable: true,
      });
      expect(calls.events).not.toContain("read");
      expect(calls.events).not.toContain("write");
      expect(calls.updates).toHaveLength(0);
      expect(calls.stages.map(({ status }) => status)).toEqual([
        "running",
        "failed",
      ]);

      calls.events = [];
      calls.stages = [];
      calls.reads = [null];
      const compatible = makeMediaDetail(
        "2.0.0-1018436",
        "a332ca9200000000000000000000000000000000",
      );
      await applySafety(compatible, parsedRecipe, "step-apply-safety");
      expect(calls.stages.map(({ status }) => status)).toEqual([
        "running",
        "succeeded",
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("dynamic readback window (AI-624)", () => {
  test("waitForReadback scales attempts from childSyncTimeoutSeconds floor for temporal vs default 600s (AI-624)", async () => {
    const { CHILD_SYNC_TIMEOUT_FLOORS } =
      await import("homelab/scripts/argocd/argocd.ts");
    const { childSyncTimeoutSeconds } =
      await import("homelab/scripts/argocd/argocd-child-sync-timeout.ts");
    const sleep = vi.spyOn(Bun, "sleep").mockResolvedValue();
    try {
      const initial = fixture();
      const temporalCurrent = {
        ...initial.current,
        deployment: {
          ...initial.current.deployment,
          environmentId: "temporal/prod",
        },
      };
      const temporalRecipe = {
        ...initial.recipe,
        application: {
          ...initial.recipe.application,
          name: "temporal",
          destination: {
            ...initial.recipe.application.destination,
            namespace: "temporal",
          },
          source: { ...initial.recipe.application.source, chart: "temporal" },
        },
        steps: initial.recipe.steps
          .filter(({ kind }) => kind !== "forum-bundle")
          .map((step) => ({ ...step, instance: "application:temporal" })),
      };
      const pending = {
        ...argoApplication(temporalCurrent, temporalRecipe, true),
        status: {
          ...argoApplication(temporalCurrent, temporalRecipe, true).status,
          health: { status: "Progressing" },
        },
      };
      calls.reads = [
        argoApplication(temporalCurrent, temporalRecipe, false),
        pending,
      ];
      await expect(
        sync(temporalCurrent, temporalRecipe, "step-sync"),
      ).rejects.toThrow("Timed out waiting for temporal to settle");
      const expectedSeconds = childSyncTimeoutSeconds(
        "temporal",
        600,
        CHILD_SYNC_TIMEOUT_FLOORS,
      );
      const expectedAttempts = Math.ceil((expectedSeconds * 1000) / 5000);
      expect(expectedAttempts).toBeGreaterThan(120);
      expect(sleep).toHaveBeenCalledTimes(expectedAttempts);
    } finally {
      sleep.mockRestore();
    }
  });
});
