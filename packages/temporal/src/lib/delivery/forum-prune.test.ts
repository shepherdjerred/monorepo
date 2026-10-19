import { describe, expect, it } from "vitest";
import { forumSyncPrunes } from "./forum-prune.ts";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "homelab/src/delivery-ownership.ts";
import { deliveryArgoParameters } from "homelab/scripts/argocd/argocd-delivery.ts";
import type { ManagedResource } from "homelab/scripts/argocd/argocd-apply-safety.ts";

const oldName = `storm-forum-release-${"a".repeat(32)}`;
const selection = {
  application: "storm-forum",
  chart: "storm-forum",
  namespace: "storm-forum",
  environmentId: "storm-forum/prod",
  repository: "https://chartmuseum.sjer.red",
  revision: "2.0.0-42",
  parameters: { "delivery.releaseId": "b".repeat(32) },
};
function fixture() {
  const finalizers: string[] = [];
  const ownerReferences: { uid: string }[] = [];
  const app = {
    metadata: {
      name: selection.application,
      uid: "app-uid",
      resourceVersion: "123",
      annotations: {
        [DELIVERY_ENVIRONMENT_ANNOTATION]: selection.environmentId,
      },
    },
    spec: {
      source: {
        chart: selection.chart,
        repoURL: selection.repository,
        targetRevision: selection.revision,
        helm: { parameters: deliveryArgoParameters(selection.parameters) },
      },
      destination: { namespace: selection.namespace },
      syncPolicy: { automated: { enabled: false } },
    },
    status: { operationState: { phase: "Succeeded" } },
  };
  const job = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: oldName,
      namespace: selection.namespace,
      uid: "old-job-uid",
      annotations: {
        "argocd.argoproj.io/tracking-id": `storm-forum:batch/Job:storm-forum/${oldName}`,
      },
      finalizers,
      ownerReferences,
    },
    status: { active: 0, conditions: [{ type: "Complete", status: "True" }] },
  };
  const pods = [
    {
      metadata: {
        name: "old-pod",
        namespace: selection.namespace,
        uid: "old-pod-uid",
        ownerReferences: [{ uid: job.metadata.uid }],
      },
      status: { phase: "Succeeded" },
    },
  ];
  const manifests = [
    {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: `storm-forum-release-${selection.parameters["delivery.releaseId"]}`,
        namespace: selection.namespace,
      },
    },
  ];
  const managed: ManagedResource[] = [
    {
      group: "batch",
      kind: "Job",
      namespace: selection.namespace,
      name: oldName,
      liveState: JSON.stringify(job),
    },
  ];
  let appReads = 0;
  const after = structuredClone(app);
  const read = async (path: string): Promise<unknown> => {
    if (path.endsWith("/manifests?revision=2.0.0-42"))
      return {
        manifests: manifests.map((manifest) => JSON.stringify(manifest)),
      };
    if (path.endsWith("/managed-resources")) return { items: managed };
    if (path.endsWith("/resource-tree"))
      return { nodes: pods.map((pod) => ({ kind: "Pod", ...pod.metadata })) };
    if (path.includes("/resource?")) {
      const query = new URLSearchParams(path.split("?")[1]);
      return {
        manifest: JSON.stringify(
          query.get("kind") === "Pod"
            ? pods.find(
                (pod) => pod.metadata.name === query.get("resourceName"),
              )
            : job,
        ),
      };
    }
    return structuredClone(appReads++ === 0 ? app : after);
  };
  return { app, after, job, pods, manifests, managed, read };
}

describe("Forum first-sync terminal migration pruning", () => {
  it("includes only obsolete terminal Jobs in the original sync, retaining the new Job and history", async () => {
    const f = fixture();
    await expect(forumSyncPrunes(selection, f.read)).resolves.toBe(true);
    expect(f.manifests[0]?.metadata.name).toContain("b".repeat(32));
    expect(f.job.status.conditions).toEqual([
      { type: "Complete", status: "True" },
    ]);
    expect(f.app).toEqual(f.after);
  });
  it("leaves ordinary releases and first Forum releases non-pruned", async () => {
    const f = fixture();
    f.managed.length = 0;
    await expect(forumSyncPrunes(selection, f.read)).resolves.toBe(false);
    await expect(
      forumSyncPrunes({ ...selection, parameters: {} }, async () => {
        throw new Error("Ordinary release must not inspect Forum resources");
      }),
    ).resolves.toBe(false);
  });
  it("preserves declared cluster-scoped Namespace with empty native namespace", async () => {
    const f = fixture();
    const namespace = {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: "storm-forum" },
    };
    f.managed.push({
      group: "",
      kind: "Namespace",
      namespace: "",
      name: "storm-forum",
      liveState: JSON.stringify(namespace),
      targetState: JSON.stringify(namespace),
    });
    await expect(forumSyncPrunes(selection, f.read)).resolves.toBe(true);
    f.managed.splice(0, 1);
    await expect(forumSyncPrunes(selection, f.read)).resolves.toBe(false);
  });
  it.each([
    "PersistentVolumeClaim",
    "Service",
    "OnePasswordItem",
    "Deployment",
  ])("rejects unrelated %s pruning", async (kind) => {
    const f = fixture();
    f.managed[0]!.kind = kind;
    await expect(forumSyncPrunes(selection, f.read)).rejects.toThrow(
      "unrelated",
    );
  });
  it.each([
    [
      "active Job",
      (f: ReturnType<typeof fixture>) => {
        f.job.status.active = 1;
      },
    ],
    [
      "nonterminal Job",
      (f: ReturnType<typeof fixture>) => {
        f.job.status.conditions = [];
      },
    ],
    [
      "active Pod",
      (f: ReturnType<typeof fixture>) => {
        f.pods[0]!.status.phase = "Running";
      },
    ],
    [
      "finalizer",
      (f: ReturnType<typeof fixture>) => {
        f.job.metadata.finalizers.push("protect");
      },
    ],
    [
      "owner",
      (f: ReturnType<typeof fixture>) => {
        f.job.metadata.ownerReferences.push({ uid: "foreign" });
      },
    ],
    [
      "foreign UID",
      (f: ReturnType<typeof fixture>) => {
        f.job.metadata.uid = "replacement";
      },
    ],
    [
      "foreign tracking",
      (f: ReturnType<typeof fixture>) => {
        f.job.metadata.annotations["argocd.argoproj.io/tracking-id"] =
          "foreign";
      },
    ],
  ] as const)("rejects %s", async (_name, mutate) => {
    const f = fixture();
    mutate(f);
    await expect(forumSyncPrunes(selection, f.read)).rejects.toThrow(
      "owned terminal",
    );
  });
  it("rejects hooks, new Job absence, source drift and changed Application UID", async () => {
    const hook = fixture();
    Object.assign(hook.job.metadata.annotations, {
      "argocd.argoproj.io/hook": "Sync",
    });
    await expect(forumSyncPrunes(selection, hook.read)).rejects.toThrow(
      "owned terminal",
    );
    const missing = fixture();
    missing.manifests.length = 0;
    await expect(forumSyncPrunes(selection, missing.read)).rejects.toThrow(
      "exact new release",
    );
    const source = fixture();
    source.after.spec.source.targetRevision = "2.0.0-43";
    await expect(forumSyncPrunes(selection, source.read)).rejects.toThrow(
      "changed before sync",
    );
    const uid = fixture();
    uid.after.metadata.uid = "replacement";
    await expect(forumSyncPrunes(selection, uid.read)).rejects.toThrow(
      "changed before sync",
    );
  });
});
