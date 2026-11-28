import { expect, test } from "vitest";
import { createFlagsApp } from "./app.ts";
import { authFromEnv } from "./auth.ts";
import {
  createFlagsTrustedProxyAddresses,
  FLAGS_TAILSCALE_INGRESS,
  type FlagsKubernetesReader,
} from "./ingress-proxy.ts";
import { FlagStore } from "./store.ts";

function clusterFixture() {
  const ingressUid = "ing-uid-flags-1";
  const controllerUid = "sts-uid-flags-1";
  const controllerName = "ts-flags-ingress";
  const proxyIp = "10.244.0.99";
  const prometheusIp = "10.244.0.42";
  const annotations: Record<string, string> = {
    "tailscale.com/tags": "tag:flags",
  };
  const ingress = {
    metadata: {
      name: FLAGS_TAILSCALE_INGRESS.name,
      namespace: FLAGS_TAILSCALE_INGRESS.namespace,
      uid: ingressUid,
      resourceVersion: "10",
      annotations,
    },
    spec: {
      ingressClassName: "tailscale",
      defaultBackend: {
        service: {
          name: FLAGS_TAILSCALE_INGRESS.serviceName,
          port: { number: FLAGS_TAILSCALE_INGRESS.port },
        },
      },
      tls: [{ hosts: [FLAGS_TAILSCALE_INGRESS.host] }],
    },
  };
  const controllerLabels: Record<string, string> = {
    ...FLAGS_TAILSCALE_INGRESS.parentLabels,
  };
  const controller = {
    metadata: {
      name: controllerName,
      namespace: FLAGS_TAILSCALE_INGRESS.proxyNamespace,
      uid: controllerUid,
      resourceVersion: "20",
      labels: controllerLabels,
    },
    spec: {
      selector: { matchLabels: { app: ingressUid } },
      template: {
        metadata: {
          labels: {
            app: ingressUid,
            ...FLAGS_TAILSCALE_INGRESS.parentLabels,
          },
        },
      },
    },
  };
  const proxyPodLabels: Record<string, string> = {
    app: ingressUid,
    ...FLAGS_TAILSCALE_INGRESS.parentLabels,
  };
  const proxyPod = {
    metadata: {
      name: `${controllerName}-0`,
      namespace: FLAGS_TAILSCALE_INGRESS.proxyNamespace,
      uid: "pod-uid-flags-1",
      resourceVersion: "30",
      labels: proxyPodLabels,
      ownerReferences: [
        {
          apiVersion: "apps/v1",
          kind: "StatefulSet",
          name: controllerName,
          uid: controllerUid,
          controller: true,
        },
      ],
    },
    status: {
      phase: "Running",
      podIP: proxyIp,
      podIPs: [{ ip: proxyIp }],
      conditions: [
        { type: "Ready", status: "True" },
        { type: "ContainersReady", status: "True" },
      ],
    },
  };
  const unrelatedProxyPod = {
    metadata: {
      name: "ts-other-ingress-0",
      namespace: FLAGS_TAILSCALE_INGRESS.proxyNamespace,
      uid: "pod-uid-other-1",
      resourceVersion: "31",
      labels: {
        app: "ing-uid-other",
        "tailscale.com/managed": "true",
        "tailscale.com/parent-resource-type": "ingress",
        "tailscale.com/parent-resource-ns": "other",
        "tailscale.com/parent-resource": "other-ingress",
      },
      ownerReferences: [],
    },
    status: {
      phase: "Running",
      podIP: "10.244.0.100",
      podIPs: [{ ip: "10.244.0.100" }],
      conditions: [
        { type: "Ready", status: "True" },
        { type: "ContainersReady", status: "True" },
      ],
    },
  };
  const pods = [proxyPod, unrelatedProxyPod];
  const read: FlagsKubernetesReader = (path) => {
    if (
      path ===
      `/apis/networking.k8s.io/v1/namespaces/${FLAGS_TAILSCALE_INGRESS.namespace}/ingresses/${FLAGS_TAILSCALE_INGRESS.name}`
    ) {
      return Promise.resolve(structuredClone(ingress));
    }
    if (
      path.startsWith(
        `/api/v1/namespaces/${FLAGS_TAILSCALE_INGRESS.proxyNamespace}/pods?`,
      )
    ) {
      return Promise.resolve({ items: structuredClone(pods) });
    }
    return path ===
      `/apis/apps/v1/namespaces/${FLAGS_TAILSCALE_INGRESS.proxyNamespace}/statefulsets/${controllerName}`
      ? Promise.resolve(structuredClone(controller))
      : Promise.reject(new Error(`Unexpected Kubernetes path: ${path}`));
  };
  return {
    ingress,
    controller,
    proxyPod,
    unrelatedProxyPod,
    pods,
    proxyIp,
    prometheusIp,
    read,
  };
}

test("accepts the verified Tailscale proxy pod IP and rejects prometheus or sibling proxy pod IPs", async () => {
  const fixture = clusterFixture();
  const store = FlagStore.open(":memory:");
  store.seedFromInventory({ kind: "system", id: "seed" });
  let peer: string | null = null;
  let reads = 0;
  const app = createFlagsApp({
    store,
    auth: {
      machineToken: "machine-secret",
      operatorLogins: ["shepherdjerred@gmail.com"],
      trustedProxyAddresses: createFlagsTrustedProxyAddresses((path) => {
        reads += 1;
        return fixture.read(path);
      }),
      publicOrigin: "https://flags.tailnet-1a49.ts.net",
    },
    peerAddress: () => peer,
  });

  const operatorHeaders = {
    origin: "https://flags.tailnet-1a49.ts.net",
    "tailscale-user-login": "shepherdjerred@gmail.com",
  };

  peer = fixture.prometheusIp;
  const fromPrometheus = await app.request("/v1/deployments", {
    headers: operatorHeaders,
  });
  expect(fromPrometheus.status).toBe(401);

  peer = "10.244.0.100";
  const fromSiblingProxy = await app.request("/v1/deployments", {
    headers: operatorHeaders,
  });
  expect(fromSiblingProxy.status).toBe(401);

  peer = fixture.proxyIp;
  const fromFlagsProxy = await app.request("/v1/deployments", {
    headers: operatorHeaders,
  });
  expect(fromFlagsProxy.status).toBe(200);

  const readsBeforeMachine = reads;
  peer = fixture.prometheusIp;
  const machineRequest = await app.request("/v1/deployments", {
    headers: { authorization: "Bearer machine-secret" },
  });
  expect(machineRequest.status).toBe(200);
  expect(reads).toBe(readsBeforeMachine);

  const health = await app.request("/healthz");
  expect(health.status).toBe(200);
  expect(reads).toBe(readsBeforeMachine);
});

test("fails closed with 503 when ingress metadata is tampered or unavailable", async () => {
  const store = FlagStore.open(":memory:");
  store.seedFromInventory({ kind: "system", id: "seed" });

  for (const mutate of [
    (f: ReturnType<typeof clusterFixture>) => {
      f.ingress.metadata.annotations["tailscale.com/funnel"] = "true";
    },
    (f: ReturnType<typeof clusterFixture>) => {
      f.proxyPod.metadata.labels["tailscale.com/parent-resource"] =
        "other-ingress";
    },
    (f: ReturnType<typeof clusterFixture>) => {
      f.unrelatedProxyPod.status.podIP = f.proxyIp;
    },
    (f: ReturnType<typeof clusterFixture>) => {
      f.controller.metadata.labels["tailscale.com/parent-resource"] =
        "other-ingress";
    },
  ]) {
    const fixture = clusterFixture();
    mutate(fixture);
    const app = createFlagsApp({
      store,
      auth: {
        machineToken: "machine-secret",
        operatorLogins: ["shepherdjerred@gmail.com"],
        trustedProxyAddresses: createFlagsTrustedProxyAddresses(fixture.read),
        publicOrigin: "https://flags.tailnet-1a49.ts.net",
      },
      peerAddress: () => fixture.proxyIp,
    });
    const response = await app.request("/v1/deployments", {
      headers: {
        origin: "https://flags.tailnet-1a49.ts.net",
        "tailscale-user-login": "shepherdjerred@gmail.com",
      },
    });
    expect(response.status).toBe(503);
  }
});

test("authFromEnv rejects setting both FLAGS_TRUSTED_PROXIES and FLAGS_INGRESS_IDENTITY_DIR", () => {
  expect(() =>
    authFromEnv({
      FLAGS_TRUSTED_PROXIES: "127.0.0.1",
      FLAGS_INGRESS_IDENTITY_DIR: "/var/run/flags-ingress",
    }),
  ).toThrow(/either FLAGS_TRUSTED_PROXIES or FLAGS_INGRESS_IDENTITY_DIR/);
});
