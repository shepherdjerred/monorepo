import { expect, test, vi } from "vitest";
import { createTrustedProxyAddresses } from "./proxy.ts";
import { ingressFixture } from "./fixture.ts";
import { authenticate } from "#infrastructure/auth.ts";
import type { RuntimeConfig } from "#infrastructure/config.ts";

function config(
  trustedProxyAddresses: RuntimeConfig["trustedProxyAddresses"],
): RuntimeConfig {
  return {
    publicOrigin: "https://delivery.example.com",
    machineCredentials: [
      {
        token: "test-machine-credential-32-characters",
        principal: {
          id: "executor",
          kind: "machine",
          scopes: ["read", "execute"],
        },
      },
    ],
    trustedProxyAddresses,
    writesEnabled: async () => false,
    enabledEnvironments: async () => [],
    operatorLogins: async () => ["operator@example.com"],
  };
}
const human = () =>
  new Request("https://delivery.example.com/api/v1/identity", {
    headers: { "Tailscale-User-Login": "operator@example.com" },
  });

function corruptIngress(f: ReturnType<typeof ingressFixture>, failure: string) {
  switch (failure) {
    case "wrong-ingress":
      f.ingress.metadata.name = "unrelated";
      return true;
    case "wrong-class":
      f.ingress.spec.ingressClassName = "nginx";
      return true;
    case "deleting-ingress":
      f.ingress.metadata.deletionTimestamp = new Date().toISOString();
      return true;
    case "wrong-backend":
      f.ingress.spec.defaultBackend.service.name = "unrelated";
      return true;
    case "public-funnel":
      f.ingress.metadata.annotations["tailscale.com/funnel"] = "true";
      return true;
    default:
      return false;
  }
}

test("fresh fixed Ingress UID and ready StatefulSet proxy authorize only the actual socket peer", async () => {
  const native = ingressFixture();
  const read = vi.fn(native.read);
  const trusted = createTrustedProxyAddresses(read);
  expect(await authenticate(human(), "10.244.0.72", config(trusted))).toEqual({
    id: "operator@example.com",
    kind: "human",
    scopes: ["read", "deploy", "approve"],
  });
  expect(read.mock.calls).toHaveLength(6);
  expect(
    await authenticate(human(), "::ffff:10.244.0.72", config(trusted)),
  ).toMatchObject({ kind: "human", id: "operator@example.com" });
  for (const address of [
    "127.0.0.1",
    "10.244.0.73",
    "::ffff:10.244.0.73",
    null,
  ])
    await expect(
      authenticate(human(), address, config(trusted)),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

test.each([
  "wrong-ingress",
  "wrong-class",
  "deleting-ingress",
  "wrong-backend",
  "public-funnel",
  "namespace",
  "unmanaged",
  "wrong-parent",
  "stale-ingress-uid",
  "not-running",
  "not-ready",
  "containers-not-ready",
  "deleting-pod",
  "bad-ip",
  "missing-owner",
  "wrong-owner-kind",
  "old-owner-uid",
  "deleting-sts",
  "foreign-sts-parent",
  "wrong-selector",
  "wrong-template",
  "truncated-list",
])("human trust rejects %s native metadata", async (failure) => {
  const f = ingressFixture();
  if (!corruptIngress(f, failure))
    switch (failure) {
      case "namespace":
        f.pod.metadata.namespace = "delivery";
        break;
      case "unmanaged":
        f.pod.metadata.labels["tailscale.com/managed"] = "false";
        break;
      case "wrong-parent":
        f.pod.metadata.labels["tailscale.com/parent-resource"] = "unrelated";
        break;
      case "stale-ingress-uid":
        f.pod.metadata.labels["app"] = "old-ingress-uid";
        break;
      case "not-running":
        f.pod.status.phase = "Pending";
        break;
      case "not-ready":
        f.pod.status.conditions[0]!.status = "False";
        break;
      case "containers-not-ready":
        f.pod.status.conditions[1]!.status = "False";
        break;
      case "deleting-pod":
        f.pod.metadata.deletionTimestamp = new Date().toISOString();
        break;
      case "bad-ip":
        f.pod.status.podIP = "not-an-ip";
        f.pod.status.podIPs = [];
        break;
      case "missing-owner":
        f.pod.metadata.ownerReferences = [];
        break;
      case "wrong-owner-kind":
        f.pod.metadata.ownerReferences[0]!.kind = "Deployment";
        break;
      case "old-owner-uid":
        f.controller.metadata.uid = "replacement-sts";
        break;
      case "deleting-sts":
        f.controller.metadata.deletionTimestamp = new Date().toISOString();
        break;
      case "foreign-sts-parent":
        f.controller.metadata.labels["tailscale.com/parent-resource"] =
          "unrelated";
        break;
      case "wrong-selector":
        f.controller.spec.selector.matchLabels.app = "old-ingress-uid";
        break;
      case "wrong-template":
        f.controller.spec.template.metadata.labels.app = "old-ingress-uid";
        break;
      case "truncated-list":
        f.pods.metadata.continue = "more-pods";
        break;
      default:
        throw new Error("Unknown negative case");
    }
  await expect(createTrustedProxyAddresses(f.read)()).rejects.toMatchObject({
    code: "PAUSED",
  });
});

test.each(["duplicate", "reused-by-unrelated-pod"])(
  "IP %s cannot authenticate identity headers",
  async (mode) => {
    const f = ingressFixture();
    const duplicate = structuredClone(f.pod);
    if (mode === "reused-by-unrelated-pod") {
      duplicate.metadata.uid = "unrelated-pod";
      duplicate.metadata.labels = { app: "unrelated" };
    }
    f.pods.items.push(duplicate);
    await expect(createTrustedProxyAddresses(f.read)()).rejects.toMatchObject({
      code: "PAUSED",
    });
  },
);

test("each request fences Kubernetes metadata again and immediately rejects Pod IP reuse or owner changes", async () => {
  const f = ingressFixture();
  const trusted = createTrustedProxyAddresses(f.read);
  expect(await trusted()).toEqual(["10.244.0.72"]);
  f.pod.metadata.labels["app"] = "other-ingress";
  await expect(trusted()).rejects.toMatchObject({ code: "PAUSED" });
  f.pod.metadata.labels["app"] = "ingress-uid";
  let reads = 0;
  await expect(
    createTrustedProxyAddresses(async (path) => {
      if (path.includes("/ingresses/") && ++reads === 2)
        f.ingress.metadata.uid = "replacement-ingress";
      return f.read(path);
    })(),
  ).rejects.toMatchObject({ code: "PAUSED" });
});

test("unrelated native resourceVersion churn does not invalidate an unchanged ready identity", async () => {
  const f = ingressFixture();
  let reads = 0;
  const trusted = createTrustedProxyAddresses(async (path) => {
    if (path.includes("/ingresses/") && ++reads === 2) {
      f.ingress.metadata.resourceVersion = "2";
      f.pod.metadata.resourceVersion = "3";
      f.controller.metadata.resourceVersion = "4";
    }
    return f.read(path);
  });
  expect(await trusted()).toEqual(["10.244.0.72"]);
});

test("Kubernetes outages block human authentication but never affect bearer authentication or elevate machine permissions", async () => {
  const read = vi.fn(async () => {
    throw new Error("Unavailable private native API");
  });
  const configured = config(createTrustedProxyAddresses(read));
  await expect(
    authenticate(human(), "10.244.0.72", configured),
  ).rejects.toMatchObject({ code: "PAUSED" });
  read.mockClear();
  const request = human();
  request.headers.set(
    "Authorization",
    "Bearer test-machine-credential-32-characters",
  );
  expect(await authenticate(request, "10.244.0.72", configured)).toEqual({
    id: "executor",
    kind: "machine",
    scopes: ["read", "execute"],
  });
  expect(read.mock.calls).toEqual([]);
  request.headers.set("Authorization", "Bearer invalid");
  await expect(
    authenticate(request, "10.244.0.72", configured),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(read.mock.calls).toEqual([]);
});

test("tagged devices without an authenticated human login remain denied even behind the verified proxy", async () => {
  const f = ingressFixture();
  await expect(
    authenticate(
      new Request("https://delivery.example.com/api/v1/identity"),
      "10.244.0.72",
      config(createTrustedProxyAddresses(f.read)),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
