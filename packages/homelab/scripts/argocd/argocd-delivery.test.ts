import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  deliverySelectionPatch,
  deliveryArgoParameters,
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

// Argo CD v3.5.4 util/helm/cmd.go cleanSetParameters preserves escaped commas.
function argoCleanSetParameters(value: string) {
  return value.startsWith("{") && value.endsWith("}")
    ? value
    : value.replaceAll(/(?<!\\),/gu, String.raw`\,`);
}

it("round-trips literal selection strings through the real Helm parameter parser", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "delivery-helm-wire-"));
  try {
    await Bun.write(
      path.join(directory, "Chart.yaml"),
      "apiVersion: v2\nname: wire-proof\nversion: 0.1.0\n",
    );
    await Bun.write(
      path.join(directory, "templates/value.yaml"),
      "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: wire-proof\ndata:\n  value: {{ .Values.delivery.workerPool | quote }}\n",
    );
    for (const logical of [
      "",
      "{}",
      "[]",
      JSON.stringify({
        versions: [
          { id: "old", note: String.raw`comma,slash\braces{}` },
          { id: "new" },
        ],
      }),
    ]) {
      const parameters = { "delivery.workerPool": logical };
      const wire = deliveryArgoParameters(parameters);
      expect(
        deliverySelectionPatch(application(), { ...selection, parameters })[2]
          ?.value,
      ).toMatchObject({ helm: { parameters: wire } });
      const parameter = wire[0];
      if (parameter === undefined) throw new Error("Wire parameter missing");
      const cleaned = argoCleanSetParameters(parameter.value);
      expect(cleaned).toBe(parameter.value);
      const child = Bun.spawn(
        [
          "helm",
          "template",
          "proof",
          directory,
          "--set-string",
          `${parameter.name}=${cleaned}`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(exit).toBe(0);
      expect(
        z
          .object({ data: z.object({ value: z.string() }) })
          .parse(Bun.YAML.parse(stdout)).data.value,
      ).toBe(logical);
      expect(parameters["delivery.workerPool"]).toBe(logical);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("accepts omitted TypeMeta from the single-Application endpoint while rejecting wrong kinds and missing ownership", () => {
  const { kind: _kind, ...endpointResponse } = application();
  expect(deliverySelectionPatch(endpointResponse, selection)).toEqual(
    deliverySelectionPatch(application(), selection),
  );
  expect(() =>
    deliverySelectionPatch(
      { ...endpointResponse, kind: "Deployment" },
      selection,
    ),
  ).toThrow();
  expect(() =>
    deliverySelectionPatch(
      {
        ...endpointResponse,
        metadata: { ...endpointResponse.metadata, annotations: {} },
      },
      selection,
    ),
  ).toThrow("delegated");
});

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
  it("rejects destination changes and switches self-healed automation off with the selection", () => {
    expect(() =>
      deliverySelectionPatch(application(), {
        ...selection,
        namespace: "another-service",
      }),
    ).toThrow("destination/source");
    const app = application();
    const healedPolicy = {
      automated: { enabled: true, selfHeal: true, prune: false },
      syncOptions: ["ServerSideApply=true"],
    };
    const healed = deliverySelectionPatch(
      { ...app, spec: { ...app.spec, syncPolicy: healedPolicy } },
      selection,
    );
    expect(healed[2]?.value).toMatchObject({ targetRevision: "2.0.0-123" });
    expect(healed[3]).toEqual({
      op: "add",
      path: "/spec/syncPolicy/automated",
      value: { enabled: false },
    });
    const { syncPolicy: _policy, ...bare } = app.spec;
    expect(
      deliverySelectionPatch({ ...app, spec: bare }, selection)[3],
    ).toEqual({
      op: "add",
      path: "/spec/syncPolicy",
      value: { automated: { enabled: false } },
    });
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
