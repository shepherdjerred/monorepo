import { expect, test, vi } from "vitest";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import {
  BootstrapApplicationSchema,
  bootstrapFingerprint,
} from "./bootstrap-selection.ts";
import {
  HandoverDescriptorSchema,
  handoverContext,
  handoverPatch,
  assertHandoverRoot,
} from "./delivery-handover-selection.ts";
import { transferDeliveryOwnership } from "./delivery-handover.ts";
import {
  assertHandoverWebhook,
  handoverAutomation,
  handoverJson,
} from "./delivery-handover-native.ts";
import { createHandoverArgo } from "./delivery-handover-access.ts";

function native(name = "arcade") {
  return BootstrapApplicationSchema.parse({
    metadata: {
      name,
      namespace: "argocd",
      uid: `uid-${name}`,
      resourceVersion: "10",
      labels: { retained: "yes" },
      annotations: { unrelated: "retained" },
      finalizers: ["resources-finalizer.argocd.argoproj.io"],
    },
    spec: {
      project: "default",
      source: {
        repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: name,
        targetRevision: "2.0.0-100",
        helm: {
          parameters: [{ name: "original", value: "exact", forceString: true }],
          valuesObject: { retained: true },
        },
      },
      destination: {
        namespace: name,
        server: "https://kubernetes.default.svc",
      },
      syncPolicy: {
        automated: { enabled: true, selfHeal: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
    status: {
      sync: { status: "Synced", revision: "2.0.0-100" },
      health: { status: "Healthy" },
    },
  });
}
function fixture() {
  const descriptor = HandoverDescriptorSchema.parse({
    schema: "delivery-ownership-handover/v1",
    sourceRevision: "a".repeat(40),
    pullRequest: 99,
    requestId: "11111111-1111-4111-8111-111111111111",
    deliveryUrl: "https://delivery.tailnet-1a49.ts.net",
    woodpeckerWebhookId: 7,
    targets: [
      {
        application: "arcade",
        environmentId: "arcade/prod",
        expectedGeneration: 0,
      },
    ],
  });
  const catalog = {
    ...SERVICE_CATALOG,
    deliveryDelegations: { arcade: "arcade/prod" },
  };
  const context = {
    schema: "delivery-ownership-context/v1",
    sourceRevision: descriptor.sourceRevision,
    catalogFingerprint: bootstrapFingerprint(catalog),
    observedAt: new Date().toISOString(),
    writesEnabled: false,
    enabledEnvironments: [],
    counts: {
      applicationLocks: 0,
      platformLocks: 0,
      activeEnvironments: 0,
      pendingDeployments: 0,
      recoveryRequired: 0,
      pendingObservations: 0,
    },
    targets: [
      {
        environmentId: "arcade/prod",
        serviceId: "arcade",
        application: "arcade",
        generation: 0,
        pipelineRevisionId: "arcade/1",
        pipeline: {
          kind: "argocd",
          application: "arcade",
          namespace: "arcade",
          chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
          chartName: "arcade",
        },
        configurationRevision: "config/1",
        configuration: { retained: "exact" },
        acceptedVersionSetRevisionId: null,
        baseline: null,
      },
    ],
  };
  const app = native();
  const root = native("apps");
  root.spec["syncPolicy"] = { automated: { enabled: false } };
  const events: unknown[] = [];
  const live = structuredClone(app);
  const effects = {
    catalog,
    context: vi.fn(() => Promise.resolve(structuredClone(context))),
    applications: vi.fn(() => Promise.resolve([structuredClone(live)])),
    root: vi.fn(() => Promise.resolve(structuredClone(root))),
    sourceProof: vi.fn(() =>
      Promise.resolve({ sourceRevision: descriptor.sourceRevision }),
    ),
    automation: vi.fn(() => Promise.resolve({ id: 7, active: false })),
    access: vi.fn(() =>
      Promise.resolve({ principals: ["delivery", "delivery-platform"] }),
    ),
    checkpoint: vi.fn((event: unknown) => {
      events.push(event);
      return Promise.resolve();
    }),
    patch: vi.fn((name: string, raw: unknown) => {
      const patch = handoverPatch(
        live,
        handoverContext(context, descriptor, catalog).targets[0]!,
      ).patch;
      expect(name).toBe(live.metadata.name);
      expect(raw).toEqual(patch);
      live.metadata.annotations["delivery.shepherdjerred.com/environment"] =
        "arcade/prod";
      live.spec["syncPolicy"] = {
        automated: { enabled: false, selfHeal: true },
        syncOptions: ["CreateNamespace=true"],
      };
      live.metadata.resourceVersion = "11";
      return Promise.resolve(structuredClone(live));
    }),
  };
  return { descriptor, context, app, root, effects, events };
}

test("registered authority handover preserves the entire native source and adds only exact ownership plus disabled automation", async () => {
  const current = fixture();
  const result = await transferDeliveryOwnership(
    current.descriptor,
    current.effects,
  );
  expect(result).toEqual({ effects: true, transferred: ["arcade"] });
  expect(current.effects.patch).toHaveBeenCalledTimes(1);
  const call = current.effects.patch.mock.calls[0];
  expect(call?.[1]).toEqual(
    expect.arrayContaining([
      { op: "test", path: "/metadata/uid", value: current.app.metadata.uid },
      { op: "test", path: "/metadata/resourceVersion", value: "10" },
      { op: "test", path: "/spec/source", value: current.app.spec["source"] },
    ]),
  );
  const mutations = handoverPatch(
    current.app,
    handoverContext(
      current.context,
      current.descriptor,
      current.effects.catalog,
    ).targets[0]!,
  ).patch.filter((operation) => operation.op !== "test");
  expect(mutations.map((operation) => operation.path)).toEqual([
    "/metadata/annotations",
    "/spec/syncPolicy",
  ]);
  expect(current.context.targets[0]?.acceptedVersionSetRevisionId).toBeNull();
  expect(current.events).toEqual([
    expect.objectContaining({ kind: "prepared" }),
    expect.objectContaining({ kind: "ownership-intent" }),
    expect.objectContaining({ kind: "ownership-readback" }),
  ]);
  expect(current.effects.context).toHaveBeenCalledTimes(2);
  expect(current.effects.access).toHaveBeenCalledTimes(2);
});

test.each([
  "writes",
  "generation",
  "source",
  "catalog",
  "locks",
  "queued",
  "recovery",
  "stale",
  "unregistered",
])(
  "fresh %s disagreement prevents native ownership effects",
  async (failure) => {
    const current = fixture();
    const raw = structuredClone(current.context);
    switch (failure) {
      case "writes":
        raw.writesEnabled = true;
        break;
      case "generation":
        raw.targets[0]!.generation = 1;
        break;
      case "source":
        raw.sourceRevision = "b".repeat(40);
        break;
      case "catalog":
        raw.catalogFingerprint = `sha256:${"c".repeat(64)}`;
        break;
      case "locks":
        raw.counts.platformLocks = 1;
        break;
      case "queued":
        raw.counts.pendingDeployments = 1;
        break;
      case "recovery":
        raw.counts.pendingObservations = 1;
        break;
      case "stale":
        raw.observedAt = "2000-01-01T00:00:00Z";
        break;
      case "unregistered":
        raw.targets = [];
        break;
      default:
        throw new Error("Unexpected failure case");
    }
    current.effects.context.mockResolvedValue(raw);
    await expect(
      transferDeliveryOwnership(current.descriptor, current.effects),
    ).rejects.toThrow();
    expect(current.effects.patch).not.toHaveBeenCalled();
  },
);

test("fresh PG baseline/configuration changes and native owner changes after prepare fail before CAS", async () => {
  const current = fixture();
  current.effects.context
    .mockResolvedValueOnce(current.context)
    .mockResolvedValue({
      ...current.context,
      targets: current.context.targets.map((row) => ({
        ...row,
        configurationRevision: "changed",
      })),
    });
  await expect(
    transferDeliveryOwnership(current.descriptor, current.effects),
  ).rejects.toThrow("admission changed");
  expect(current.effects.patch).not.toHaveBeenCalled();
  const nativeChanged = fixture();
  const changed = structuredClone(nativeChanged.app);
  changed.metadata.annotations["foreign"] = "owner";
  nativeChanged.effects.applications
    .mockResolvedValueOnce([nativeChanged.app])
    .mockResolvedValue([changed]);
  await expect(
    transferDeliveryOwnership(nativeChanged.descriptor, nativeChanged.effects),
  ).rejects.toThrow("source/lifecycle changed");
  expect(nativeChanged.effects.patch).not.toHaveBeenCalled();
});

test("dry run is read-only and missing independent specialized baseline is not replaced by an imported snapshot", async () => {
  const current = fixture();
  expect(
    await transferDeliveryOwnership(current.descriptor, current.effects, true),
  ).toEqual({ effects: false, transferred: [] });
  expect(current.effects.patch).not.toHaveBeenCalled();
  const row = current.context.targets[0]!;
  for (const policy of [{ workerRollout: {} }, { forumRelease: {} }])
    expect(() =>
      handoverContext(
        {
          ...current.context,
          targets: [{ ...row, pipeline: { ...row.pipeline, ...policy } }],
        },
        current.descriptor,
        current.effects.catalog,
      ),
    ).toThrow("baseline");
});

test("source mismatch, unexpected native owner and unexplained shared-resource root drift are never rewritten", () => {
  const current = fixture(),
    row = handoverContext(
      current.context,
      current.descriptor,
      current.effects.catalog,
    ).targets[0]!;
  const changed = structuredClone(current.app);
  changed.spec["source"] = {
    repoURL: "https://unexpected.example",
    chart: "arcade",
  };
  expect(() => handoverPatch(changed, row)).toThrow(
    "never changes selected sources",
  );
  changed.spec = current.app.spec;
  changed.metadata.annotations["delivery.shepherdjerred.com/environment"] =
    "foreign/prod";
  expect(() => handoverPatch(changed, row)).toThrow(
    "different deployment owner",
  );
  expect(() =>
    assertHandoverRoot(
      {
        ...current.root,
        status: {
          ...current.root.status,
          sync: { status: "OutOfSync", revision: "2.0.0-100" },
          resources: [
            { kind: "Secret", name: "unrelated", status: "OutOfSync" },
          ],
        },
      },
      ["arcade"],
    ),
  ).toThrow("Unrelated root");
});

test("old automation proof requires the exact disabled webhook and no native pending/running/blocked pipeline", async () => {
  const current = fixture();
  const raw = [
    [
      {
        id: 7,
        active: false,
        config: { url: "https://woodpecker.sjer.red/hook?private=value" },
      },
    ],
  ];
  expect(assertHandoverWebhook(raw, 7)).toEqual({
    id: 7,
    active: false,
    origin: "https://woodpecker.sjer.red",
    path: "/hook",
  });
  expect(() => assertHandoverWebhook(raw, 8)).toThrow("exact Woodpecker");
  expect(() =>
    assertHandoverWebhook(
      [
        [
          ...raw[0]!,
          {
            id: 8,
            active: true,
            config: { url: "https://woodpecker.sjer.red/hook" },
          },
        ],
      ],
      7,
    ),
  ).toThrow("disabled");
  const read = vi.fn((command: string[]): Promise<unknown> =>
    Promise.resolve(command[0] === "gh" ? raw : []),
  );
  await handoverAutomation(current.descriptor, read);
  expect(read).toHaveBeenCalledTimes(4);
  read.mockImplementation((command) =>
    Promise.resolve(command[0] === "gh" ? raw : [{ number: 123 }]),
  );
  await expect(handoverAutomation(current.descriptor, read)).rejects.toThrow(
    "pipeline prevents",
  );
});

test("default handover transport reads the exact native API for every active status", async () => {
  const config = {
    baseUrl: "https://woodpecker.sjer.red",
    repoId: 1,
    token: "synthetic",
  };
  const json = vi.fn((): Promise<unknown> => Promise.resolve([]));
  const current = fixture();
  const hooks = [
    [
      {
        id: 7,
        active: false,
        config: { url: "https://woodpecker.sjer.red/hook" },
      },
    ],
  ];
  const read = (command: string[]) =>
    command[0] === "gh"
      ? Promise.resolve(hooks)
      : handoverJson(command, { config: () => Promise.resolve(config), json });
  await handoverAutomation(current.descriptor, read);
  expect(json.mock.calls).toEqual(
    ["pending", "running", "blocked"].map((status) => [
      `/api/repos/1/pipelines?status=${status}&perPage=1`,
      config,
    ]),
  );
  json.mockImplementation(() =>
    Promise.resolve([{ number: 10_955, status: "pending" }]),
  );
  await expect(handoverAutomation(current.descriptor, read)).rejects.toThrow(
    "Native pending pipeline prevents",
  );
});

test("handover API transport refuses malformed, wrong-status and over-limit responses", async () => {
  const command = [
    "toolkit",
    "woodpecker",
    "pipeline",
    "ls",
    "shepherdjerred/monorepo",
    "--status",
    "pending",
    "--limit",
    "1",
    "--output",
    "json",
  ];
  const connection = {
    baseUrl: "https://woodpecker.sjer.red",
    repoId: 1,
    token: "synthetic",
  };
  const config = async () => connection;
  for (const response of [
    "",
    {},
    [{ number: 1 }],
    [{ number: 1, status: "success" }],
    [{ number: 1, status: "running" }],
    [
      { number: 1, status: "pending" },
      { number: 2, status: "pending" },
    ],
  ]) {
    await expect(
      handoverJson(command, { config, json: () => Promise.resolve(response) }),
    ).rejects.toThrow();
  }
  for (const actual of [
    { baseUrl: "https://example.invalid", repoId: 1, token: "synthetic" },
    { baseUrl: "https://woodpecker.sjer.red", repoId: 2, token: "synthetic" },
  ]) {
    const json = vi.fn(() => Promise.resolve([]));
    await expect(
      handoverJson(command, { config: () => Promise.resolve(actual), json }),
    ).rejects.toThrow("canonical Woodpecker repository");
    expect(json).not.toHaveBeenCalled();
  }
  const json = vi.fn(() => Promise.resolve([]));
  await expect(
    handoverJson([...command, "--event", "push"], { config, json }),
  ).rejects.toThrow();
  expect(json).not.toHaveBeenCalled();
});

test("handover native client rejects admin identities and chooses two separate scoped capabilities for actual PATCHes", async () => {
  const current = fixture();
  const calls: { path: string; authorization: string; method: string }[] = [];
  const client = createHandoverArgo(
    { workload: "test-workload", platform: "test-platform" },
    async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const authorization =
        new Headers(init?.headers).get("authorization") ?? "";
      calls.push({
        path: url.pathname,
        authorization,
        method: init?.method ?? "GET",
      });
      if (url.pathname.endsWith("userinfo"))
        return Response.json({
          loggedIn: true,
          username: authorization.endsWith("test-workload")
            ? "delivery"
            : "delivery-platform",
        });
      if (url.pathname.includes("can-i")) {
        const denied =
          url.pathname.includes("update") &&
          ((authorization.endsWith("test-workload") &&
            !url.pathname.endsWith("arcade")) ||
            (authorization.endsWith("test-platform") &&
              url.pathname.endsWith("arcade")));
        return Response.json({ value: denied ? "no" : "yes" });
      }
      return Response.json(current.app);
    },
  );
  await client.access(current.descriptor);
  await client.patch("arcade", []);
  await client.patch("delivery-control-plane", []);
  expect(
    calls
      .filter((call) => call.method === "PATCH")
      .map((call) => call.authorization),
  ).toEqual(["Bearer test-workload", "Bearer test-platform"]);
  const admin = createHandoverArgo(
    { workload: "test-admin", platform: "test-admin" },
    () => Promise.resolve(Response.json({ loggedIn: true, username: "admin" })),
  );
  await expect(admin.access(current.descriptor)).rejects.toThrow();
});

test("control-plane handover requires only the exact producer resource update capability", async () => {
  const current = fixture();
  const descriptor = {
    ...current.descriptor,
    targets: [
      {
        application: "delivery-control-plane",
        environmentId: "delivery-control-plane/prod",
        expectedGeneration: 0,
      },
    ],
  };
  const actions: string[] = [];
  let broad = false;
  let missing = false;
  const client = createHandoverArgo(
    { workload: "test-workload", platform: "test-platform" },
    (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const workload =
        new Headers(init?.headers)
          .get("authorization")
          ?.endsWith("test-workload") === true;
      if (url.pathname.endsWith("userinfo"))
        return Promise.resolve(
          Response.json({
            loggedIn: true,
            username: workload ? "delivery" : "delivery-platform",
          }),
        );
      const segments = url.pathname
        .split("/")
        .map((value) => decodeURIComponent(value));
      const action = segments.at(-2) ?? "";
      const application = segments.at(-1) ?? "";
      actions.push(action);
      const allowed =
        action === "get" ||
        (!workload &&
          application === "default/delivery-control-plane" &&
          (action === "update" ||
            (!missing &&
              action ===
                "update/apps/Deployment/temporal/temporal-delivery-worker") ||
            broad));
      return Promise.resolve(Response.json({ value: allowed ? "yes" : "no" }));
    },
  );
  await expect(client.access(descriptor)).resolves.toBeDefined();
  expect(actions).toContain(
    "update/apps/Deployment/temporal/temporal-delivery-worker",
  );
  expect(actions).toContain(
    "update/apps/Deployment/temporal/temporal-delivery-platform-worker",
  );
  expect(actions).toContain("update//Pod/temporal/temporal-delivery-worker");
  missing = true;
  await expect(client.access(descriptor)).rejects.toThrow(
    "reviewed account boundary",
  );
  missing = false;
  broad = true;
  await expect(client.access(descriptor)).rejects.toThrow(
    "reviewed account boundary",
  );
});
