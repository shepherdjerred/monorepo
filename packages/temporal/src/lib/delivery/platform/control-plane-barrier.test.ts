import { expect, test, vi } from "vitest";
import { z } from "zod";
import {
  pauseDeliveryDispatch,
  restoreDeliveryDispatch,
  type BarrierEffects,
} from "./control-plane-barrier.ts";
import { patchDeliveryDispatchResource } from "./control-plane-barrier-argo.ts";

function fixture() {
  let replicas = 1;
  let uid = "deployment-uid";
  const calls: string[] = [];
  const host = () => ({
    metadata: {
      name: "temporal-delivery-worker",
      namespace: "temporal",
      uid,
      resourceVersion: "42",
    },
    spec: {
      replicas,
      template: { spec: { containers: [{ image: "original@sha256:abc" }] } },
    },
    status: { replicas },
  });
  const pod = {
    metadata: {
      uid: "old-pod",
      labels: { component: "delivery-worker" },
      ownerReferences: [
        { uid: "old-rs", kind: "ReplicaSet", controller: true },
      ],
    },
  };
  const effects: BarrierEffects = {
    read: async () => host(),
    pods: async () => (replicas === 1 ? [pod] : []),
    replicaSet: async () => ({
      metadata: {
        uid: "old-rs",
        ownerReferences: [{ uid, kind: "Deployment", controller: true }],
      },
    }),
    patch: vi.fn(async (patch) => {
      calls.push("patch");
      replicas = z.object({ value: z.number() }).parse(patch.at(-1)).value;
    }),
    checkpoint: vi.fn(async () => {
      calls.push("checkpoint");
    }),
    fence: vi.fn(async () => {
      calls.push("fence");
    }),
    wait: async () => {
      /* Disposable observations advance synchronously. */
    },
  };
  return {
    effects,
    calls,
    replace: () => {
      uid = "replacement";
    },
  };
}
test("durably checkpoints exact host/Pod ownership before CAS stop; recovery restores only same UID/template", async () => {
  const { effects, calls, replace } = fixture();
  const journal = await pauseDeliveryDispatch(effects);
  expect(calls.slice(0, 3)).toEqual(["checkpoint", "fence", "patch"]);
  expect(effects.patch).toHaveBeenCalledWith([
    { op: "test", path: "/metadata/uid", value: "deployment-uid" },
    { op: "test", path: "/metadata/resourceVersion", value: "42" },
    { op: "test", path: "/spec/replicas", value: 1 },
    { op: "replace", path: "/spec/replicas", value: 0 },
  ]);
  await restoreDeliveryDispatch(effects, journal);
  expect(effects.patch).toHaveBeenCalledTimes(2);
  replace();
  await expect(restoreDeliveryDispatch(effects, journal)).rejects.toThrow(
    "UID or template changed",
  );
  expect(effects.patch).toHaveBeenCalledTimes(2);
});
test("a still-running old process and an unknown ReplicaSet owner block replacement", async () => {
  const { effects } = fixture();
  const pods = await effects.pods();
  effects.pods = async () => pods;
  await expect(pauseDeliveryDispatch(effects)).rejects.toThrow(
    "did not terminate",
  );
  const second = fixture();
  second.effects.replicaSet = async () => ({ metadata: { uid: "foreign" } });
  await expect(pauseDeliveryDispatch(second.effects)).rejects.toThrow();
  expect(second.effects.checkpoint).not.toHaveBeenCalled();
  expect(second.effects.patch).not.toHaveBeenCalled();
});
test("pinned Argo resource RPC receives POST scalar JSON patch with exact typed target", async () => {
  const old = {
    url: Bun.env["ARGOCD_SERVER_URL"],
    token: Bun.env["ARGOCD_TOKEN"],
  };
  Bun.env["ARGOCD_SERVER_URL"] = "https://argocd.example.test";
  Bun.env["ARGOCD_TOKEN"] = "test-only";
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      expect(request.method).toBe("POST");
      expect(url.pathname).toBe(
        "/api/v1/applications/delivery-control-plane/resource",
      );
      expect(Object.fromEntries(url.searchParams)).toEqual({
        resourceName: "temporal-delivery-worker",
        namespace: "temporal",
        kind: "Deployment",
        group: "apps",
        version: "v1",
        patchType: "application/json-patch+json",
      });
      const body = z.string().parse(await request.json());
      expect(JSON.parse(body)).toEqual([
        { op: "test", path: "/spec/replicas", value: 1 },
      ]);
      return Response.json({ manifest: "{}" });
    },
  });
  try {
    Bun.env["ARGOCD_SERVER_URL"] = server.url.origin;
    await patchDeliveryDispatchResource([
      { op: "test", path: "/spec/replicas", value: 1 },
    ]);
  } finally {
    await server.stop(true);
    if (old.url === undefined) delete Bun.env["ARGOCD_SERVER_URL"];
    else Bun.env["ARGOCD_SERVER_URL"] = old.url;
    if (old.token === undefined) delete Bun.env["ARGOCD_TOKEN"];
    else Bun.env["ARGOCD_TOKEN"] = old.token;
  }
});
