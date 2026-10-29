import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createArgoApplication,
  deleteArgoApplication,
  DELIVERY_ENVIRONMENT_ANNOTATION,
  getArgoApplication,
  setArgoSelfHeal,
  updateArgoApplication,
} from "./argo-client.ts";

const environmentId = "arcade/prod";
function application(overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      name: "arcade",
      resourceVersion: "41",
      annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: environmentId },
    },
    spec: {
      project: "workloads",
      source: {
        repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: "arcade",
        targetRevision: "1.2.3",
        helm: { parameters: [{ name: "image", value: "x@sha256:abc" }] },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "arcade",
      },
      syncPolicy: { automated: { enabled: false } },
    },
    ...overrides,
  };
}

type Call = { method: string; url: string; body: unknown };
function transport(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: URL, init: RequestInit) => {
    const call = {
      method: init.method ?? "GET",
      url: input.toString(),
      body:
        typeof init.body === "string"
          ? z.unknown().parse(JSON.parse(init.body))
          : null,
    };
    calls.push(call);
    return await respond(call);
  });
  return { fetch, calls };
}

beforeEach(() => {
  Bun.env["ARGOCD_SERVER_URL"] = "https://argocd.example.test";
  Bun.env["ARGOCD_TOKEN"] = "test-token";
});
afterEach(() => {
  Reflect.deleteProperty(Bun.env, "ARGOCD_SERVER_URL");
  Reflect.deleteProperty(Bun.env, "ARGOCD_TOKEN");
});

describe("getArgoApplication", () => {
  it("returns null on 404 and the object otherwise", async () => {
    const missing = transport(() => new Response("", { status: 404 }));
    expect(await getArgoApplication("arcade", missing)).toBeNull();
    expect(missing.calls[0]).toMatchObject({
      method: "GET",
      url: "https://argocd.example.test/api/v1/applications/arcade",
    });
    const found = transport(() => Response.json(application()));
    expect(await getArgoApplication("arcade", found)).toEqual(application());
    const broken = transport(() => new Response("", { status: 500 }));
    await expect(getArgoApplication("arcade", broken)).rejects.toThrow(
      "HTTP 500",
    );
  });

  it("names the project so Argo reports an absent Application as 404, not 403", async () => {
    const missing = transport(() => new Response("", { status: 404 }));
    expect(
      await getArgoApplication("arcade", { ...missing, project: "workloads" }),
    ).toBeNull();
    expect(missing.calls[0]?.url).toBe(
      "https://argocd.example.test/api/v1/applications/arcade?project=workloads",
    );
  });
});

describe("createArgoApplication", () => {
  it("posts the full body without upsert and refuses unowned bodies", async () => {
    const created = transport(({ body }) => Response.json(body));
    const { resourceVersion: _version, ...metadata } = application().metadata;
    const body = { ...application(), metadata };
    await createArgoApplication(body, created);
    expect(created.calls[0]).toMatchObject({
      method: "POST",
      url: "https://argocd.example.test/api/v1/applications?upsert=false",
      body,
    });
    await expect(
      createArgoApplication(
        { ...body, metadata: { name: "arcade", annotations: {} } },
        created,
      ),
    ).rejects.toThrow("ownership annotation");
    const conflict = transport(() => new Response("", { status: 409 }));
    await expect(createArgoApplication(body, conflict)).rejects.toThrow(
      "already exists",
    );
  });
});

describe("updateArgoApplication", () => {
  it("replaces the body only under the observed resourceVersion and ownership", async () => {
    const current = application();
    const { fetch, calls } = transport(({ method, body }) =>
      method === "GET" ? Response.json(current) : Response.json(body),
    );
    const desired = application({
      spec: { ...application().spec, project: "changed" },
    });
    await updateArgoApplication(
      "arcade",
      desired,
      { environmentId },
      { fetch },
    );
    expect(calls.map((call) => call.method)).toEqual(["GET", "PUT"]);
    expect(calls[1]).toMatchObject({
      url: "https://argocd.example.test/api/v1/applications/arcade",
      body: desired,
    });
  });
  it("refuses a stale resourceVersion, a foreign owner, a body dropping ownership and a 409", async () => {
    const stale = transport(() => Response.json(application()));
    await expect(
      updateArgoApplication(
        "arcade",
        application({
          metadata: { ...application().metadata, resourceVersion: "40" },
        }),
        { environmentId },
        stale,
      ),
    ).rejects.toThrow("changed since it was read");
    const foreign = transport(() =>
      Response.json(
        application({
          metadata: {
            ...application().metadata,
            annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: "arcade/beta" },
          },
        }),
      ),
    );
    await expect(
      updateArgoApplication(
        "arcade",
        application(),
        { environmentId },
        foreign,
      ),
    ).rejects.toThrow("not owned by Delivery environment arcade/prod");
    const dropping = transport(() => Response.json(application()));
    await expect(
      updateArgoApplication(
        "arcade",
        application({
          metadata: { ...application().metadata, annotations: {} },
        }),
        { environmentId },
        dropping,
      ),
    ).rejects.toThrow("keep Delivery's environment ownership annotation");
    const raced = transport(({ method }) =>
      method === "GET"
        ? Response.json(application())
        : new Response("", { status: 409 }),
    );
    await expect(
      updateArgoApplication("arcade", application(), { environmentId }, raced),
    ).rejects.toThrow("changed concurrently");
    const absent = transport(() => new Response("", { status: 404 }));
    await expect(
      updateArgoApplication("arcade", application(), { environmentId }, absent),
    ).rejects.toThrow("does not exist");
  });
});

describe("deleteArgoApplication", () => {
  it("deletes an owned Application with the lifecycle policy and treats absence as already deleted", async () => {
    const owned = transport(({ method }) =>
      method === "GET" ? Response.json(application()) : Response.json({}),
    );
    expect(
      await deleteArgoApplication(
        "arcade",
        { environmentId, cascade: true },
        owned,
      ),
    ).toEqual({ deleted: true });
    expect(owned.calls[1]).toMatchObject({
      method: "DELETE",
      url: "https://argocd.example.test/api/v1/applications/arcade?cascade=true&propagationPolicy=foreground",
    });
    const retained = transport(({ method }) =>
      method === "GET" ? Response.json(application()) : Response.json({}),
    );
    await deleteArgoApplication(
      "arcade",
      { environmentId, cascade: false },
      retained,
    );
    expect(retained.calls[1]?.url).toContain(
      "cascade=false&propagationPolicy=orphan",
    );
    const absent = transport(() => new Response("", { status: 404 }));
    expect(
      await deleteArgoApplication(
        "arcade",
        { environmentId, cascade: true },
        absent,
      ),
    ).toEqual({ deleted: false });
    const foreign = transport(() =>
      Response.json(
        application({
          metadata: { ...application().metadata, annotations: {} },
        }),
      ),
    );
    await expect(
      deleteArgoApplication(
        "arcade",
        { environmentId, cascade: true },
        foreign,
      ),
    ).rejects.toThrow("not owned");
  });
});

describe("setArgoSelfHeal", () => {
  it("enables self-heal without prune only on the accepted exact source", async () => {
    const current = application();
    const { fetch, calls } = transport(({ method, body }) => {
      if (method === "GET") return Response.json(current);
      const patch = z
        .array(z.unknown())
        .parse(JSON.parse(z.object({ patch: z.string() }).parse(body).patch));
      expect(patch).toEqual([
        { op: "test", path: "/metadata/resourceVersion", value: "41" },
        {
          op: "test",
          path: "/metadata/annotations/delivery.shepherdjerred.com~1environment",
          value: environmentId,
        },
        {
          op: "add",
          path: "/spec/syncPolicy/automated",
          value: { enabled: true, selfHeal: true, prune: false },
        },
      ]);
      return Response.json(
        application({
          metadata: { ...current.metadata, resourceVersion: "42" },
        }),
      );
    });
    expect(
      await setArgoSelfHeal(
        "arcade",
        { environmentId, expectedSource: structuredClone(current.spec.source) },
        { fetch },
      ),
    ).toEqual({ resourceVersion: "42" });
    expect(calls.map((call) => call.method)).toEqual(["GET", "PATCH"]);
  });
  it("adds the whole syncPolicy when the body has none", async () => {
    const { syncPolicy: _policy, ...spec } = application().spec;
    const bare = { ...application(), spec };
    const { fetch } = transport(({ method, body }) => {
      if (method === "GET") return Response.json(bare);
      const patch = z
        .array(z.object({ op: z.string(), path: z.string() }).loose())
        .parse(JSON.parse(z.object({ patch: z.string() }).parse(body).patch));
      expect(patch[2]).toMatchObject({ op: "add", path: "/spec/syncPolicy" });
      return Response.json(bare);
    });
    await setArgoSelfHeal(
      "arcade",
      { environmentId, expectedSource: bare.spec.source },
      { fetch },
    );
  });
  it("refuses a drifted source, a foreign owner and a lost CAS", async () => {
    const drifted = transport(() => Response.json(application()));
    await expect(
      setArgoSelfHeal(
        "arcade",
        {
          environmentId,
          expectedSource: { ...application().spec.source, targetRevision: "9" },
        },
        drifted,
      ),
    ).rejects.toThrow("differs from the accepted exact source");
    expect(drifted.calls).toHaveLength(1);
    const foreign = transport(() =>
      Response.json(
        application({
          metadata: { ...application().metadata, annotations: {} },
        }),
      ),
    );
    await expect(
      setArgoSelfHeal(
        "arcade",
        { environmentId, expectedSource: application().spec.source },
        foreign,
      ),
    ).rejects.toThrow("not owned");
    const raced = transport(({ method }) =>
      method === "GET"
        ? Response.json(application())
        : new Response("", { status: 409 }),
    );
    await expect(
      setArgoSelfHeal(
        "arcade",
        { environmentId, expectedSource: application().spec.source },
        raced,
      ),
    ).rejects.toThrow("changed concurrently");
  });
});
