import { expect, test } from "bun:test";
import {
  AUTO_SYNC_POLICY_ABSENT,
  autoSyncPolicyDivergences,
} from "./argocd-auto-sync-policy.ts";

function application(
  name: string,
  syncPolicy?: Record<string, unknown>,
): string {
  return JSON.stringify({
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: { name },
    ...(syncPolicy === undefined ? {} : { spec: { syncPolicy } }),
  });
}

function liveList(
  entries: readonly { name: string; syncPolicy?: Record<string, unknown> }[],
): unknown {
  return {
    items: entries.map(({ name, syncPolicy }) => ({
      metadata: { name },
      ...(syncPolicy === undefined ? {} : { spec: { syncPolicy } }),
    })),
  };
}

test("reports no divergence when live matches the declaration", () => {
  const divergences = autoSyncPolicyDivergences(
    [application("worker", { automated: { enabled: true, prune: true } })],
    liveList([
      {
        name: "worker",
        syncPolicy: { automated: { enabled: true, prune: true } },
      },
    ]),
  );

  expect(divergences).toEqual([]);
});

// The shape a self-healing platform Application declares, and the shape the
// release's manifest override turns it into.
const SELF_HEALING = { enabled: true, prune: true, selfHeal: true };
const SUSPENDED = { enabled: false, prune: true, selfHeal: true };

test("reports an external child left auto-sync suspended", () => {
  const divergences = autoSyncPolicyDivergences(
    [application("worker", { automated: SELF_HEALING })],
    liveList([{ name: "worker", syncPolicy: { automated: SUSPENDED } }]),
  );

  expect(divergences).toEqual([
    'worker: live {"enabled":false,"prune":true,"selfHeal":true} ' +
      'declared {"enabled":true,"prune":true,"selfHeal":true}',
  ]);
});

test("accepts a repository chart declared permanently suspended", () => {
  const divergences = autoSyncPolicyDivergences(
    [application("repository", { automated: { enabled: false } })],
    liveList([
      { name: "repository", syncPolicy: { automated: { enabled: false } } },
    ]),
  );

  expect(divergences).toEqual([]);
});

test("accepts the root apps Application declared suspended", () => {
  const divergences = autoSyncPolicyDivergences(
    [application("apps", { automated: { enabled: false } })],
    liveList([{ name: "apps", syncPolicy: { automated: { enabled: false } } }]),
  );

  expect(divergences).toEqual([]);
});

test("ignores an Application the rendered revision does not declare", () => {
  const divergences = autoSyncPolicyDivergences(
    [application("worker", { automated: { enabled: true } })],
    liveList([
      { name: "worker", syncPolicy: { automated: { enabled: true } } },
      // A prune candidate left behind by a retirement — not this check's business.
      { name: "plausible", syncPolicy: { automated: { enabled: false } } },
    ]),
  );

  expect(divergences).toEqual([]);
});

test("ignores an Application that declares no automated policy", () => {
  const divergences = autoSyncPolicyDivergences(
    [application("worker", { syncOptions: ["CreateNamespace=true"] })],
    liveList([
      { name: "worker", syncPolicy: { automated: { enabled: false } } },
    ]),
  );

  expect(divergences).toEqual([]);
});

test("ignores an Application the rendered revision declares but the cluster lacks", () => {
  const divergences = autoSyncPolicyDivergences(
    [application("worker", { automated: { enabled: true } })],
    liveList([]),
  );

  expect(divergences).toEqual([]);
});

test("treats reordered keys as equal", () => {
  const divergences = autoSyncPolicyDivergences(
    [application("worker", { automated: SELF_HEALING })],
    liveList([
      {
        name: "worker",
        syncPolicy: {
          automated: { selfHeal: true, enabled: true, prune: true },
        },
      },
    ]),
  );

  expect(divergences).toEqual([]);
});

test("reports a live Application that dropped its automated policy entirely", () => {
  const divergences = autoSyncPolicyDivergences(
    [application("worker", { automated: { enabled: true } })],
    liveList([{ name: "worker", syncPolicy: {} }]),
  );

  expect(divergences).toEqual([
    `worker: live ${AUTO_SYNC_POLICY_ABSENT} declared {"enabled":true}`,
  ]);
});

test("reports every divergent Application in name order", () => {
  const divergences = autoSyncPolicyDivergences(
    [
      application("zebra", { automated: { enabled: true } }),
      application("alpha", { automated: { enabled: true } }),
      application("middle", { automated: { enabled: true } }),
    ],
    liveList([
      { name: "zebra", syncPolicy: { automated: { enabled: false } } },
      { name: "alpha", syncPolicy: { automated: { enabled: false } } },
      { name: "middle", syncPolicy: { automated: { enabled: true } } },
    ]),
  );

  expect(divergences).toEqual([
    'alpha: live {"enabled":false} declared {"enabled":true}',
    'zebra: live {"enabled":false} declared {"enabled":true}',
  ]);
});

test("skips manifests that are not Applications", () => {
  const divergences = autoSyncPolicyDivergences(
    [
      JSON.stringify({
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "worker" },
        data: { key: "value" },
      }),
    ],
    liveList([
      { name: "worker", syncPolicy: { automated: { enabled: false } } },
    ]),
  );

  expect(divergences).toEqual([]);
});

// A manifest that names no kind cannot be judged "not an Application" — the
// skip above is for manifests that say what they are. Silently passing over one
// would drop a real Application from the comparison and report agreement the
// release never actually checked.
test("rejects a rendered manifest declaring no kind", () => {
  expect(() =>
    autoSyncPolicyDivergences(
      [
        JSON.stringify({
          apiVersion: "argoproj.io/v1alpha1",
          metadata: { name: "worker" },
          spec: { syncPolicy: { automated: { enabled: true } } },
        }),
      ],
      liveList([]),
    ),
  ).toThrow();
});

test("rejects a rendered manifest whose kind is empty", () => {
  expect(() =>
    autoSyncPolicyDivergences(
      [
        JSON.stringify({
          apiVersion: "argoproj.io/v1alpha1",
          kind: "",
          metadata: { name: "worker" },
          spec: { syncPolicy: { automated: { enabled: true } } },
        }),
      ],
      liveList([]),
    ),
  ).toThrow();
});

test("rejects a rendered Application that is missing its name", () => {
  expect(() =>
    autoSyncPolicyDivergences(
      [JSON.stringify({ kind: "Application", spec: {} })],
      liveList([]),
    ),
  ).toThrow();
});

test("accepts a live list served as null items", () => {
  const divergences = autoSyncPolicyDivergences(
    [application("worker", { automated: { enabled: true } })],
    { items: null },
  );

  expect(divergences).toEqual([]);
});
