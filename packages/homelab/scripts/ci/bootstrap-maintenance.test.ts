import { expect, test } from "vitest";
import { assertBootstrapMaintenance } from "./bootstrap-maintenance.ts";
import { BootstrapApplicationSchema } from "./bootstrap-selection.ts";

const ROOT = { status: { sync: { status: "Synced" } } };
const RULES = [
  {
    application: "golink",
    kind: "PersistentVolumeClaim",
    name: "golink-pvc",
    namespace: "golink",
    jsonPointers: ["/spec/volumeName"],
  },
  {
    application: "prometheus",
    kind: "Secret",
    name: "prometheus-grafana",
    namespace: "prometheus",
    jsonPointers: ["/data/admin-password"],
  },
] as const;

function fixture(rule: (typeof RULES)[number], name?: string) {
  const { application: originalName, ...fields } = rule;
  const application = name ?? originalName;
  const selector = { ...fields, jsonPointers: [...fields.jsonPointers] };
  const metadata = {
    name: application,
    namespace: "argocd",
    labels: { "ci.sjer.red/managed-application": "true" },
    annotations: {
      "argocd.argoproj.io/sync-wave": "-1",
      "argocd.argoproj.io/tracking-id": `apps:argoproj.io/Application:argocd/${application}`,
      "ci.sjer.red/application-lifecycle": "cascade",
    },
    finalizers: ["resources-finalizer.argocd.argoproj.io"],
  };
  const prior = {
    source: {
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: application,
      targetRevision: "2.0.0-100",
      helm: { valuesObject: { untouched: { group: "" } } },
    },
    destination: { namespace: application, server: "in-cluster" },
    syncPolicy: { automated: { enabled: true, prune: true } },
    ignoreDifferences: [{ group: "", ...selector }],
  };
  const app = BootstrapApplicationSchema.parse({
    metadata: { ...metadata, uid: "original-uid", resourceVersion: "1" },
    spec: { ...prior, ignoreDifferences: [selector] },
    status: {
      sync: { status: "Synced", revision: "2.0.0-100" },
      health: { status: "Healthy" },
    },
  });
  const manifests = [
    JSON.stringify({
      kind: "Application",
      metadata,
      spec: prior,
    }),
  ];
  return { app, prior, manifests, selector, metadata };
}

test.each(RULES)(
  "accepts Argo's omitted core group for $application without changing either spec",
  (rule) => {
    const { app, prior, manifests } = fixture(rule);
    const before = structuredClone({ app, prior });
    expect(() =>
      assertBootstrapMaintenance(ROOT, [app], manifests),
    ).not.toThrow();
    expect({ app, prior }).toEqual(before);
    // The semantic comparison must work in the opposite direction as well.
    const reversed = [
      JSON.stringify({
        kind: "Application",
        metadata: app.metadata,
        spec: app.spec,
      }),
    ];
    expect(() =>
      assertBootstrapMaintenance(ROOT, [{ ...app, spec: prior }], reversed),
    ).not.toThrow();
  },
);

test.each([
  { field: "group", value: "apps" },
  { field: "group", value: null },
  { field: "kind", value: "ConfigMap" },
  { field: "name", value: "another-secret" },
  { field: "namespace", value: "another-namespace" },
  { field: "jsonPointers", value: ["/data"] },
  { field: "jqPathExpressions", value: [".data"] },
])("rejects real ignore rule drift in $field ($value)", ({ field, value }) => {
  const { app, manifests, selector } = fixture(RULES[1]);
  app.spec["ignoreDifferences"] = [{ ...selector, [field]: value }];
  expect(() => assertBootstrapMaintenance(ROOT, [app], manifests)).toThrow(
    "Unreviewed native root drift for prometheus",
  );
});

test.each(["source", "nested group", "sync policy"])(
  "does not normalize or exempt %s outside ignore rule groups",
  (field) => {
    const { app, prior, manifests } = fixture(RULES[1]);
    if (field === "source") {
      app.spec["source"] = {
        ...prior.source,
        targetRevision: "2.0.0-101",
      };
    } else if (field === "nested group") {
      app.spec["source"] = {
        ...prior.source,
        helm: { valuesObject: { untouched: {} } },
      };
    } else {
      app.spec["syncPolicy"] = { automated: { enabled: false, prune: true } };
    }
    expect(() => assertBootstrapMaintenance(ROOT, [app], manifests)).toThrow(
      "Unreviewed native root drift for prometheus",
    );
  },
);

test("core-group normalization preserves the explicit root maintenance pause guard", () => {
  const { app, manifests } = fixture(RULES[0], "apps");
  app.spec["syncPolicy"] = {};
  const root = {
    status: {
      sync: { status: "OutOfSync" },
      resources: [{ kind: "Application", name: "apps", status: "OutOfSync" }],
    },
  };
  expect(() =>
    assertBootstrapMaintenance(root, [app], manifests),
  ).not.toThrow();
  app.spec["syncPolicy"] = { automated: { enabled: true, prune: false } };
  expect(() => assertBootstrapMaintenance(root, [app], manifests)).toThrow();
});

test.each(["apps", "argocd"])(
  "%s maintenance plus core-group normalization cannot hide lifecycle metadata drift",
  (name) => {
    const { app, manifests } = fixture(RULES[0], name);
    app.spec["syncPolicy"] = {};
    const root = {
      status: {
        sync: { status: "OutOfSync" },
        resources: [{ kind: "Application", name, status: "OutOfSync" }],
      },
    };
    expect(() =>
      assertBootstrapMaintenance(root, [app], manifests),
    ).not.toThrow();
    app.metadata.annotations["ci.sjer.red/application-lifecycle"] = "retain";
    expect(() => assertBootstrapMaintenance(root, [app], manifests)).toThrow(
      `Unreviewed native metadata drift for ${name}`,
    );
  },
);

const PROM_OUT_OF_SYNC = {
  status: {
    sync: { status: "OutOfSync" },
    resources: [
      { kind: "Application", name: "prometheus", status: "OutOfSync" },
    ],
  },
};

test.each([undefined, "normal", "hard"])(
  "explains representation-only root drift with undeclared hydration %s",
  (hydrate) => {
    const { app, prior, manifests } = fixture(RULES[1]);
    if (hydrate !== undefined)
      app.metadata.annotations["argocd.argoproj.io/hydrate"] = hydrate;
    const before = structuredClone(app);
    const argocd = BootstrapApplicationSchema.parse({
      ...app,
      metadata: { ...app.metadata, name: "argocd" },
      spec: { ...prior, syncPolicy: {} },
    });
    const root = structuredClone(PROM_OUT_OF_SYNC);
    root.status.resources.push({
      kind: "Application",
      name: "argocd",
      status: "OutOfSync",
    });
    expect(() =>
      assertBootstrapMaintenance(
        root,
        [app, argocd],
        [
          ...manifests,
          JSON.stringify({
            kind: "Application",
            metadata: argocd.metadata,
            spec: prior,
          }),
        ],
      ),
    ).not.toThrow();
    expect(app).toEqual(before);
  },
);

test.each([
  "labels",
  "annotations",
  "finalizers",
  "namespace",
  "tracking",
  "hydrate",
])("does not hide concurrent managed metadata drift in %s", (field) => {
  const { app, manifests } = fixture(RULES[1]);
  switch (field) {
    case "labels":
      app.metadata.labels["unreviewed"] = "true";
      break;
    case "annotations":
      app.metadata.annotations["unreviewed"] = "true";
      break;
    case "finalizers":
      app.metadata.finalizers = [];
      break;
    case "namespace":
      app.metadata.namespace = "other";
      break;
    case "tracking":
      app.metadata.annotations["argocd.argoproj.io/tracking-id"] =
        "different-owner";
      break;
    default:
      app.metadata.annotations["argocd.argoproj.io/hydrate"] = "unknown";
  }
  expect(() =>
    assertBootstrapMaintenance(PROM_OUT_OF_SYNC, [app], manifests),
  ).toThrow("Unreviewed native metadata drift for prometheus");
});

test("declared hydration changes remain drift", () => {
  const { app, prior, metadata } = fixture(RULES[1]);
  const manifests = [
    JSON.stringify({
      kind: "Application",
      metadata: {
        ...metadata,
        annotations: {
          ...metadata.annotations,
          "argocd.argoproj.io/hydrate": "normal",
        },
      },
      spec: prior,
    }),
  ];
  app.metadata.annotations["argocd.argoproj.io/hydrate"] = "hard";
  expect(() =>
    assertBootstrapMaintenance(PROM_OUT_OF_SYNC, [app], manifests),
  ).toThrow("Unreviewed native metadata drift for prometheus");
});

test("identical specs cannot explain an OutOfSync resource", () => {
  const { app, prior, manifests } = fixture(RULES[1]);
  app.spec = prior;
  expect(() =>
    assertBootstrapMaintenance(PROM_OUT_OF_SYNC, [app], manifests),
  ).toThrow("Root OutOfSync is not explained");
});

test.each(["ConfigMap", "Application"])(
  "representation-only drift cannot authorize an unrelated %s",
  (kind) => {
    const { app, manifests } = fixture(RULES[1]);
    const root = structuredClone(PROM_OUT_OF_SYNC);
    root.status.resources.push({
      kind,
      name: "unrelated",
      status: "OutOfSync",
    });
    expect(() => assertBootstrapMaintenance(root, [app], manifests)).toThrow(
      "Root shared-resource or unrelated drift prevents bootstrap",
    );
  },
);
