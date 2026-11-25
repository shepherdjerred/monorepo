import { expect, test } from "vitest";
import { authenticateConsole, authenticateMachine } from "./auth.ts";
import {
  createFeedsTrustedProxyAddresses,
  FEEDS_TAILSCALE_INGRESS,
  FeedsIngressIdentityError,
  type FeedsKubernetesReader,
} from "./ingress-proxy.ts";

function clusterFixture() {
  const ingressUid = "ing-uid-feeds-1";
  const controllerUid = "sts-uid-feeds-1";
  const controllerName = "ts-feeds-ingress";
  const proxyIp = "10.244.0.88";
  const prometheusIp = "10.244.0.42";
  const annotations: Record<string, string> = {
    "tailscale.com/tags": "tag:k8s",
  };
  const ingress = {
    metadata: {
      name: FEEDS_TAILSCALE_INGRESS.name,
      namespace: FEEDS_TAILSCALE_INGRESS.namespace,
      uid: ingressUid,
      resourceVersion: "10",
      annotations,
    },
    spec: {
      ingressClassName: "tailscale",
      defaultBackend: {
        service: {
          name: FEEDS_TAILSCALE_INGRESS.serviceName,
          port: { number: FEEDS_TAILSCALE_INGRESS.port },
        },
      },
      tls: [{ hosts: [FEEDS_TAILSCALE_INGRESS.host] }],
    },
  };
  const controllerLabels: Record<string, string> = {
    ...FEEDS_TAILSCALE_INGRESS.parentLabels,
  };
  const controller = {
    metadata: {
      name: controllerName,
      namespace: FEEDS_TAILSCALE_INGRESS.proxyNamespace,
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
            ...FEEDS_TAILSCALE_INGRESS.parentLabels,
          },
        },
      },
    },
  };
  const proxyPodLabels: Record<string, string> = {
    app: ingressUid,
    ...FEEDS_TAILSCALE_INGRESS.parentLabels,
  };
  const proxyPod = {
    metadata: {
      name: `${controllerName}-0`,
      namespace: FEEDS_TAILSCALE_INGRESS.proxyNamespace,
      uid: "pod-uid-feeds-1",
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
      namespace: FEEDS_TAILSCALE_INGRESS.proxyNamespace,
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
  const read: FeedsKubernetesReader = (path) => {
    if (
      path ===
      `/apis/networking.k8s.io/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.namespace}/ingresses/${FEEDS_TAILSCALE_INGRESS.name}`
    ) {
      return Promise.resolve(structuredClone(ingress));
    }
    if (
      path.startsWith(
        `/api/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.proxyNamespace}/pods?`,
      )
    ) {
      return Promise.resolve({ items: structuredClone(pods) });
    }
    return path ===
      `/apis/apps/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.proxyNamespace}/statefulsets/${controllerName}`
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

test("matches exact FEEDS_TAILSCALE_INGRESS coordinates", () => {
  expect(FEEDS_TAILSCALE_INGRESS).toEqual({
    namespace: "feeds",
    name: "feeds-feeds-ingress-ingress",
    proxyNamespace: "tailscale",
    serviceName: "feeds",
    port: 7430,
    host: "feeds",
    directory: "/var/run/feeds-ingress",
    parentLabels: {
      "tailscale.com/managed": "true",
      "tailscale.com/parent-resource-type": "ingress",
      "tailscale.com/parent-resource-ns": "feeds",
      "tailscale.com/parent-resource": "feeds-feeds-ingress-ingress",
    },
  });
});

test("accepts the verified Tailscale proxy pod IP and rejects prometheus or sibling proxy pod IPs", async () => {
  const fixture = clusterFixture();
  let reads = 0;
  const config = {
    machineToken: "machine-secret",
    operatorLogins: ["shepherdjerred@gmail.com"],
    trustedProxyAddresses: createFeedsTrustedProxyAddresses((path) => {
      reads += 1;
      return fixture.read(path);
    }),
    publicOrigin: "https://feeds.tailnet-1a49.ts.net",
  };

  const operatorHeaders = {
    origin: "https://feeds.tailnet-1a49.ts.net",
    "tailscale-user-login": "shepherdjerred@gmail.com",
  };

  const fromPrometheus = await authenticateConsole(
    new Request("https://feeds.tailnet-1a49.ts.net/api/v1/summary", {
      headers: operatorHeaders,
    }),
    fixture.prometheusIp,
    config,
  );
  expect(fromPrometheus).toEqual({
    status: 401,
    error: "authenticated private ingress required",
  });

  const fromSiblingProxy = await authenticateConsole(
    new Request("https://feeds.tailnet-1a49.ts.net/api/v1/summary", {
      headers: operatorHeaders,
    }),
    "10.244.0.100",
    config,
  );
  expect(fromSiblingProxy).toEqual({
    status: 401,
    error: "authenticated private ingress required",
  });

  const fromFeedsProxy = await authenticateConsole(
    new Request("https://feeds.tailnet-1a49.ts.net/api/v1/summary", {
      headers: operatorHeaders,
    }),
    fixture.proxyIp,
    config,
  );
  expect(fromFeedsProxy).toEqual({
    kind: "human",
    login: "shepherdjerred@gmail.com",
  });

  const readsBeforeMachine = reads;
  const machineAuth = authenticateMachine(
    new Request("http://feeds:7430/internal/refresh", {
      method: "POST",
      headers: { authorization: "Bearer machine-secret" },
    }),
    config,
  );
  expect(machineAuth).toEqual({ kind: "machine" });
  expect(reads).toBe(readsBeforeMachine);
});

test("fails closed with 503 when ingress metadata is tampered or mid-rollout snapshots disagree", async () => {
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
    const verify = createFeedsTrustedProxyAddresses(fixture.read);
    await expect(verify()).rejects.toBeInstanceOf(FeedsIngressIdentityError);

    const response = await authenticateConsole(
      new Request("https://feeds.tailnet-1a49.ts.net/api/v1/summary", {
        headers: {
          "tailscale-user-login": "shepherdjerred@gmail.com",
        },
      }),
      fixture.proxyIp,
      {
        machineToken: "machine-secret",
        operatorLogins: ["shepherdjerred@gmail.com"],
        trustedProxyAddresses: verify,
        publicOrigin: "https://feeds.tailnet-1a49.ts.net",
      },
    );
    expect(response).toEqual({
      status: 503,
      error: "private ingress identity could not be verified",
    });
  }

  // Mid-update snapshot race: IP changes between first and second fence reads.
  const raceFixture = clusterFixture();
  let podReads = 0;
  const racingVerify = createFeedsTrustedProxyAddresses((path) => {
    if (path.includes("/pods?")) {
      podReads += 1;
      if (podReads > 1) {
        raceFixture.proxyPod.status.podIP = "10.244.0.89";
        raceFixture.proxyPod.status.podIPs = [{ ip: "10.244.0.89" }];
      }
    }
    return raceFixture.read(path);
  });
  await expect(racingVerify()).rejects.toBeInstanceOf(
    FeedsIngressIdentityError,
  );
});
