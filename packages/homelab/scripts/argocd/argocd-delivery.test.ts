import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deliverySelectionPatch,
  assertDeliveryRootPreservesSelection,
} from "./argocd-delivery.ts";
import {
  DELIVERY_ENVIRONMENT_ANNOTATION,
  DELIVERY_ROOT_IGNORE_EXPRESSIONS,
  deliveryEnvironment,
} from "#delivery-ownership";

function application() {
  return {
    kind: "Application",
    metadata: {
      name: "arcade",
      resourceVersion: "123",
      annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: "arcade/prod" },
    },
    spec: {
      source: {
        repoURL: "https://chartmuseum.sjer.red",
        chart: "arcade",
        targetRevision: "2.0.0-old",
        helm: { values: "environment: prod" },
      },
      destination: { namespace: "arcade" },
      syncPolicy: { automated: { enabled: false } },
    },
  };
}
const selection = {
  application: "arcade",
  environmentId: "arcade/prod",
  repository: "https://chartmuseum.sjer.red",
  chart: "arcade",
  revision: "2.0.0-123",
  parameters: {
    image: `docker.io/shepherdjerred/arcade@sha256:${"a".repeat(64)}`,
  },
};

describe("Delivery Application ownership", () => {
  it("rejects queued or stale active operations before producing any selection mutation", () => {
    expect(() =>
      deliverySelectionPatch(
        { ...application(), operation: { sync: { revision: "2.0.0-older" } } },
        selection,
      ),
    ).toThrow();
    for (const phase of ["Running", "Terminating"]) {
      expect(() =>
        deliverySelectionPatch(
          { ...application(), status: { operationState: { phase } } },
          selection,
        ),
      ).toThrow("not settled");
    }
    expect(() =>
      deliverySelectionPatch(
        {
          ...application(),
          operation: null,
          status: { operationState: { phase: "Succeeded" } },
        },
        selection,
      ),
    ).not.toThrow();
  });
  it("root reconciliation leaves delegated children to their PostgreSQL-selected release", async () => {
    const requests: string[] = [];
    const delegated = { ...application(), apiVersion: "argoproj.io/v1alpha1" };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);
        if (url.pathname === "/api/charts/apps")
          return Response.json([
            {
              version: "2.0.0-42",
              urls: ["charts/apps-2.0.0-42.tgz"],
              digest: "a".repeat(64),
            },
          ]);
        return url.pathname === "/api/v1/applications/apps/manifests"
          ? Response.json({ manifests: [JSON.stringify(delegated)] })
          : Response.json(
              { error: "Unexpected child operation" },
              { status: 500 },
            );
      },
    });
    const directory = await mkdtemp(path.join(tmpdir(), "delivery-root-"));
    const expected = path.join(directory, "expected.json");
    await Bun.write(
      expected,
      JSON.stringify([
        { name: "apps", revision: "2.0.0-42", prune: false },
        { name: "arcade", revision: "2.0.0-42", prune: false },
      ]),
    );
    try {
      const child = Bun.spawn(
        [
          "bun",
          "scripts/argocd/argocd.ts",
          "reconcile-release",
          expected,
          "--skip-health-wait",
          "--timeout",
          "1",
        ],
        {
          cwd: new URL("../..", import.meta.url).pathname,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            PATH: Bun.env["PATH"],
            ARGOCD_SERVER_URL: server.url.origin,
            CHARTMUSEUM_ORIGIN: server.url.origin,
            ARGOCD_TOKEN: "test-only",
          },
        },
      );
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(requests).toEqual([
        "GET /api/charts/apps",
        "GET /api/v1/applications/apps/manifests",
      ]);
    } finally {
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("patches exact selection with optimistic concurrency and retains unrelated chart values", () => {
    const patch = deliverySelectionPatch(application(), selection);
    expect(patch[0]).toEqual({
      op: "test",
      path: "/metadata/resourceVersion",
      value: "123",
    });
    expect(patch[2]?.value).toMatchObject({
      targetRevision: "2.0.0-123",
      helm: {
        values: "environment: prod",
        parameters: [
          {
            name: "image",
            value: selection.parameters.image,
            forceString: true,
          },
        ],
      },
    });
  });
  it("rejects undelegated, differently owned, root and floating releases", () => {
    const app = application();
    expect(() =>
      deliverySelectionPatch(
        { ...app, metadata: { ...app.metadata, annotations: {} } },
        selection,
      ),
    ).toThrow("delegated");
    expect(() =>
      deliverySelectionPatch(app, {
        ...selection,
        environmentId: "arcade/beta",
      }),
    ).toThrow("delegated");
    expect(() =>
      deliverySelectionPatch(app, { ...selection, revision: "latest" }),
    ).toThrow();
    expect(() =>
      deliveryEnvironment({
        ...app,
        metadata: { ...app.metadata, name: "apps" },
      }),
    ).toThrow("non-root");
  });
  it("rejects destination changes and enabled automatic sync", () => {
    expect(() =>
      deliverySelectionPatch(application(), {
        ...selection,
        namespace: "another-service",
      }),
    ).toThrow("destination/source");
    const app = application();
    expect(() =>
      deliverySelectionPatch(
        {
          ...app,
          spec: { ...app.spec, syncPolicy: { automated: { enabled: true } } },
        },
        selection,
      ),
    ).toThrow();
  });
  it("requires ignored fields to be preserved during apply", () => {
    const root = {
      spec: {
        syncPolicy: { syncOptions: ["RespectIgnoreDifferences=true"] },
        ignoreDifferences: [
          {
            group: "argoproj.io",
            kind: "Application",
            jqPathExpressions: DELIVERY_ROOT_IGNORE_EXPRESSIONS,
          },
        ],
      },
    };
    expect(() => assertDeliveryRootPreservesSelection(root)).not.toThrow();
    expect(() =>
      assertDeliveryRootPreservesSelection({
        spec: { ...root.spec, syncPolicy: { syncOptions: [] } },
      }),
    ).toThrow("preserve");
  });
});
