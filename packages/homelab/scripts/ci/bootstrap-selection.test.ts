import { expect, test, vi } from "vitest";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";
import { stageChart } from "#scripts/helm/helm-push.ts";
import { parseAllDocuments, stringify } from "yaml";
import {
  BootstrapDescriptorSchema,
  BootstrapApplicationSchema,
  bootstrapRootManifest,
  bootstrapImageManifest,
  assertBootstrapSnapshot,
  assertBootstrapRootPaused,
  BOOTSTRAP_DELIVERY_ORIGIN,
} from "./bootstrap-selection.ts";
import { reviewedAccountSource } from "./bootstrap-account-policy.ts";
import {
  bootstrapOperationReceipt,
  bootstrapSourceCas,
  assertBootstrapRegistryEmpty,
  rereadBootstrapApplications,
} from "./bootstrap-native.ts";

function descriptor() {
  const sourceRevision = "a".repeat(40);
  const image = (name: string) => ({
    repository: `docker.io/shepherdjerred/${name}`,
    sourceRevision,
    digest: `sha256:${"b".repeat(64)}`,
    version: "2.0.0-700",
  });
  return BootstrapDescriptorSchema.parse({
    schema: "delivery-bootstrap/v1",
    sourceRevision,
    pullRequest: 99,
    revision: "2.0.0-701",
    requestId: "11111111-1111-4111-8111-111111111111",
    targets: ["woodpecker", "delivery"],
    images: {
      woodpecker: image("woodpecker-config-extension"),
      delivery: image("delivery"),
    },
  });
}
function native(name: string) {
  return BootstrapApplicationSchema.parse({
    metadata: {
      name,
      namespace: "argocd",
      uid: `uid-${name}`,
      resourceVersion: "10",
      annotations: { "ci.sjer.red/application-lifecycle": "retain" },
      finalizers: ["resources-finalizer.argocd.argoproj.io"],
    },
    spec: {
      source: {
        repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: name,
        targetRevision: "2.0.0-600",
        helm: {
          parameters: [
            { name: "original", value: "retained", forceString: true },
          ],
        },
      },
      destination: {
        namespace: name,
        server: "https://kubernetes.default.svc",
      },
      syncPolicy: { automated: { enabled: false } },
    },
    status: {
      sync: { status: "Synced", revision: "2.0.0-600" },
      health: { status: "Healthy" },
    },
  });
}
function source(apps: ReturnType<typeof native>[]) {
  return apps
    .map((app) =>
      stringify({
        apiVersion: app.apiVersion,
        kind: app.kind,
        metadata: {
          name: app.metadata.name,
          namespace: "argocd",
          annotations: app.metadata.annotations,
        },
        spec: app.spec,
      }),
    )
    .join("---\n");
}
test("derived root actually preserves original forum source, whole unrelated specs/lifecycle and prior shared resources", () => {
  const captured = [native("woodpecker"), native("storm-forum")];
  const declared = [
    native("woodpecker"),
    native("delivery"),
    native("delivery-control-plane"),
    native("storm-forum"),
  ];
  declared[1]!.metadata.annotations["delivery.shepherdjerred.com/environment"] =
    "delivery/prod";
  declared[3]!.spec["source"] = {
    repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
    chart: "storm-forum",
    targetRevision: "2.0.0-701",
  };
  const priorShared = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "old-policy", namespace: "argocd" },
    data: { policy: "original" },
  };
  const nextShared = { ...priorShared, data: { policy: "different" } };
  const raw = `${stringify(nextShared)}---\n${stringify({ apiVersion: "v1", kind: "Secret", metadata: { name: "unrelated-new-secret" } })}---\n${source(declared)}`;
  const rendered = parseAllDocuments(
    bootstrapRootManifest(
      raw,
      captured,
      descriptor(),
      `${stringify(priorShared)}---\n${source(captured)}`,
    ),
  ).map((doc) => doc.toJSON());
  expect(rendered.find((item) => item.kind === "ConfigMap")).toEqual(
    priorShared,
  );
  expect(rendered.some((item) => item.kind === "Secret")).toBe(false);
  expect(
    rendered.find((item) => item.metadata.name === "delivery").metadata
      .annotations["delivery.shepherdjerred.com/environment"],
  ).toBeUndefined();
  const forum = rendered.find((item) => item.metadata.name === "storm-forum");
  expect(forum.spec).toEqual(captured[1]!.spec);
  expect(forum.metadata.finalizers).toEqual(captured[1]!.metadata.finalizers);
  expect(forum.metadata.annotations).toEqual(captured[1]!.metadata.annotations);
  expect(
    rendered.some((item) => item.metadata.name === "delivery-control-plane"),
  ).toBe(false);
  expect(
    rendered.find((item) => item.metadata.name === "delivery").spec.source.helm
      .parameters,
  ).toEqual([
    {
      name: "delivery.image",
      value: `docker.io/shepherdjerred/delivery@sha256:${"b".repeat(64)}`,
      forceString: true,
    },
  ]);
});
test("bootstrap rejects missing or extra child registrations, duplicate snapshots, delegated state and changed native UID/source", () => {
  const captured = [native("woodpecker"), native("storm-forum")];
  const declared = [...captured, native("delivery")];
  const render = (apps: ReturnType<typeof native>[], capture = captured) =>
    bootstrapRootManifest(
      source(apps),
      capture,
      descriptor(),
      source(captured),
    );
  expect(() =>
    render(declared.filter((app) => app.metadata.name !== "storm-forum")),
  ).toThrow("prune live");
  expect(() => render([...declared, native("unexpected")])).toThrow(
    "create unrelated",
  );
  expect(() => render(declared, [...captured, captured[0]!])).toThrow(
    "Duplicate native",
  );
  const delegated = structuredClone(captured);
  delegated[0]!.metadata.annotations[
    "delivery.shepherdjerred.com/environment"
  ] = "woodpecker/prod";
  expect(() => render(declared, delegated)).toThrow("delegated");
  const statusOnly = structuredClone(captured);
  statusOnly[0]!.metadata.resourceVersion = "11";
  expect(() => assertBootstrapSnapshot(captured, statusOnly)).not.toThrow();
  statusOnly[0]!.metadata.uid = "replacement";
  expect(() => assertBootstrapSnapshot(captured, statusOnly)).toThrow(
    "identity",
  );
  const changed = structuredClone(captured);
  changed[1]!.spec["source"] = { targetRevision: "foreign" };
  expect(() => assertBootstrapSnapshot(captured, changed)).toThrow("source");
});
test("only immutable fixed image repositories/original sources and the two Woodpecker bindings are allowed", () => {
  const config = descriptor();
  expect(() =>
    BootstrapDescriptorSchema.parse({ ...config, targets: ["storm-forum"] }),
  ).toThrow();
  expect(() =>
    BootstrapDescriptorSchema.parse({
      ...config,
      images: {
        ...config.images,
        delivery: { ...config.images.delivery, sourceRevision: "c".repeat(40) },
      },
    }),
  ).toThrow("reviewed source");
  const old =
    "docker.io/shepherdjerred/woodpecker-config-extension:2.0.0-600@sha256:" +
    "c".repeat(64);
  const raw = `image: ${old}\nenv: ${old}\n`;
  const selected = bootstrapImageManifest(raw, "woodpecker", config);
  expect(selected.match(/sha256:b{64}/gu)).toHaveLength(2);
  expect(() =>
    bootstrapImageManifest(`image: ${old}`, "woodpecker", config),
  ).toThrow("exactly");
});

test("account prerequisite changes only reviewed Delivery principals, retaining the upstream chart and unrelated roles", () => {
  const original = native("argocd");
  const accountSource = {
    repoURL: "https://argoproj.github.io/argo-helm",
    chart: "argo-cd",
    targetRevision: "9.5.12",
    helm: {
      valuesObject: {
        configs: {
          cm: { "accounts.woodpecker": "apiKey", unrelated: "retained" },
          rbac: {
            "policy.default": "",
            "policy.csv":
              "p, woodpecker, applications, get, default/*, allow\ng, humans, role:admin\np, delivery, applications, get, default/arcade, allow",
          },
        },
        controller: { replicas: 1 },
      },
      parameters: [{ name: "server.replicas", value: "1" }],
    },
  };
  original.spec["source"] = accountSource;
  const next = reviewedAccountSource(original);
  expect(next.repoURL).toBe(accountSource.repoURL);
  expect(next.chart).toBe(accountSource.chart);
  expect(next.targetRevision).toBe(accountSource.targetRevision);
  expect(next.helm.parameters).toEqual(accountSource.helm.parameters);
  const values = z
    .object({
      controller: z.object({ replicas: z.number() }),
      configs: z.object({
        cm: z.record(z.string(), z.json()),
        rbac: z.record(z.string(), z.json()),
      }),
    })
    .parse(next.helm.valuesObject);
  expect(values.controller).toEqual({ replicas: 1 });
  expect(values.configs.cm["accounts.woodpecker"]).toBe("apiKey");
  expect(
    values.configs.cm[
      "server.rbac.disableApplicationFineGrainedRBACInheritance"
    ],
  ).toBe(true);
  expect(next.helm.valuesObject.configs.cm["accounts.delivery-platform"]).toBe(
    "apiKey",
  );
  expect(next.helm.valuesObject.configs.rbac["policy.csv"]).toContain(
    "g, humans, role:admin",
  );
  expect(values.configs.rbac["policy.default"]).toBe("");
  const invalid = structuredClone(original);
  invalid.spec["source"] = {
    ...accountSource,
    helm: {
      ...accountSource.helm,
      parameters: [
        { name: String.raw`configs.rbac.policy\.csv`, value: "foreign" },
      ],
    },
  };
  expect(() => reviewedAccountSource(invalid)).toThrow("parameter override");
  invalid.spec["source"] = {
    ...accountSource,
    helm: {
      ...accountSource.helm,
      parameters: [
        {
          name: String.raw`configs.cm.server\.rbac\.disableApplicationFineGrainedRBACInheritance`,
          value: "false",
        },
      ],
    },
  };
  expect(() => reviewedAccountSource(invalid)).toThrow("parameter override");
  invalid.spec["source"] = {
    ...accountSource,
    helm: {
      ...accountSource.helm,
      valuesObject: {
        configs: {
          cm: {},
          rbac: { "policy.csv": "", "policy.default": "role:readonly" },
        },
      },
    },
  };
  expect(() => reviewedAccountSource(invalid)).toThrow("default role empty");
});

test("bootstrap operation readback requires the exact requester and a finished native UUID", () => {
  const request = descriptor().requestId;
  const state = {
    metadata: { name: "apps", uid: "root-original" },
    status: {
      operationState: {
        phase: "Succeeded",
        finishedAt: "2026-10-17T00:00:00Z",
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: request },
            {
              name: "ci.sjer.red/operation-id",
              value: "22222222-2222-4222-8222-222222222222",
            },
          ],
        },
      },
    },
  };
  expect(bootstrapOperationReceipt(state, request)).toMatchObject({
    applicationUid: "root-original",
    requestId: request,
    operationId: "22222222-2222-4222-8222-222222222222",
  });
  expect(() => bootstrapOperationReceipt(state, crypto.randomUUID())).toThrow(
    "another request",
  );
  state.status.operationState.phase = "Running";
  expect(() => bootstrapOperationReceipt(state, request)).toThrow();
});

test("fresh PG ownership is mandatory once the Delivery Application exists", async () => {
  const inspect = vi.fn(async () => []);
  await assertBootstrapRegistryEmpty(
    [native("woodpecker")],
    undefined,
    inspect,
  );
  expect(inspect).not.toHaveBeenCalled();
  await expect(
    assertBootstrapRegistryEmpty([native("delivery")], undefined, inspect),
  ).rejects.toThrow("catalog URL");
  const url = BOOTSTRAP_DELIVERY_ORIGIN;
  await assertBootstrapRegistryEmpty([native("delivery")], url, inspect);
  expect(inspect).toHaveBeenCalledWith(url);
  await expect(
    assertBootstrapRegistryEmpty([native("delivery")], url, async () => [
      { id: "arcade/prod" },
    ]),
  ).rejects.toThrow("PostgreSQL");
  await expect(
    assertBootstrapRegistryEmpty([native("delivery")], url, async () => {
      throw new Error("API unavailable");
    }),
  ).rejects.toThrow("API unavailable");
  await expect(
    assertBootstrapRegistryEmpty([native("delivery")], url, async () => ({
      environments: [],
    })),
  ).rejects.toThrow();
});

test("fresh ownership annotations block CAS and all-inventory inspection before any PATCH", async () => {
  const prior = native("delivery");
  const delegated = structuredClone(prior);
  delegated.metadata.annotations["delivery.shepherdjerred.com/environment"] =
    "delivery/prod";
  const request = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json(delegated));
  vi.stubEnv("ARGOCD_TOKEN", "test-bootstrap-operator");
  try {
    await expect(
      bootstrapSourceCas(prior, prior.spec["source"]),
    ).rejects.toThrow("delegated");
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(async () =>
      Response.json({ items: [delegated] }),
    );
    await expect(rereadBootstrapApplications([])).rejects.toThrow(
      "Live Delivery-owned",
    );
    expect(
      request.mock.calls.every(([, options]) => options?.method !== "PATCH"),
    ).toBe(true);
  } finally {
    request.mockRestore();
    vi.unstubAllEnvs();
  }
});

test("source CAS fences the freshly inspected resource version and refuses annotation drift", async () => {
  const prior = native("delivery");
  const fresh = structuredClone(prior);
  fresh.metadata.resourceVersion = "22";
  const selected = {
    ...z.record(z.string(), z.json()).parse(prior.spec["source"]),
    targetRevision: "2.0.0-701",
  };
  const request = vi
    .spyOn(globalThis, "fetch")
    .mockImplementationOnce(async () => Response.json(fresh))
    .mockImplementationOnce(async (_input, options) => {
      const body = z
        .object({ patch: z.string() })
        .parse(JSON.parse(z.string().parse(options?.body)));
      expect(JSON.parse(body.patch)).toContainEqual({
        op: "test",
        path: "/metadata/resourceVersion",
        value: "22",
      });
      return Response.json({
        ...fresh,
        spec: { ...fresh.spec, source: selected },
      });
    });
  vi.stubEnv("ARGOCD_TOKEN", "test-bootstrap-operator");
  try {
    await bootstrapSourceCas(prior, selected);
    fresh.metadata.annotations["unrelated-new-owner"] = "changed";
    request.mockImplementation(async () => Response.json(fresh));
    await expect(bootstrapSourceCas(prior, selected)).rejects.toThrow(
      "changed",
    );
    expect(request).toHaveBeenCalledTimes(3);
  } finally {
    request.mockRestore();
    vi.unstubAllEnvs();
  }
});

test("both prerequisites require paused root automation", () => {
  const root = native("apps");
  assertBootstrapRootPaused(root);
  root.spec["syncPolicy"] = { automated: { enabled: true } };
  expect(() => assertBootstrapRootPaused(root)).toThrow();
  root.spec["syncPolicy"] = { automated: null };
  assertBootstrapRootPaused(root);
});

test("the immutable packaged root keeps Forum on its native source in the restored chart", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delivery-bootstrap-chart-"),
  );
  try {
    const forum = native("storm-forum");
    const root = native("apps");
    const raw = bootstrapRootManifest(
      source([root, forum, native("delivery")]),
      [root, forum],
      { ...descriptor(), targets: ["delivery"] },
      source([root, forum]),
    );
    const manifestPath = path.join(directory, "apps.yaml");
    await Bun.write(manifestPath, raw);
    const archive = await stageChart(
      {
        name: "apps",
        chartDirectory: new URL("../../src/cdk8s/helm/apps/", import.meta.url)
          .pathname,
        manifestPath,
        fingerprint: "bootstrap-test",
      },
      descriptor().revision,
      directory,
    );
    const rendered = await run(["helm", "template", "bootstrap", archive], {
      capture: true,
      echoCapturedStdout: false,
    });
    const applications = parseAllDocuments(rendered.stdout).map((doc) =>
      z
        .object({
          metadata: z.object({ name: z.string() }),
          spec: z.record(z.string(), z.json()),
        })
        .parse(doc.toJSON()),
    );
    expect(
      applications.find((app) => app.metadata.name === "storm-forum")?.spec,
    ).toEqual(forum.spec);
    expect(
      applications.find((app) => app.metadata.name === "delivery")?.spec[
        "source"
      ],
    ).toMatchObject({ targetRevision: descriptor().revision });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
