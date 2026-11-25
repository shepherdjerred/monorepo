import { describe, expect, test } from "vitest";
import { authenticateConsole, authenticateMachine } from "./auth.ts";
import {
  createFeedsTrustedProxyAddresses,
  FEEDS_TAILSCALE_INGRESS,
  FeedsIngressIdentityError,
  type FeedsKubernetesReader,
} from "./ingress-proxy.ts";

const READY_POD_CONDITIONS = [
  { type: "Ready", status: "True" },
  { type: "ContainersReady", status: "True" },
];

function makeRunningPod(options: {
  readonly name: string;
  readonly uid: string;
  readonly resourceVersion: string;
  readonly ip: string;
  readonly labels: Record<string, string>;
  readonly controller?:
    { readonly name: string; readonly uid: string } | undefined;
}) {
  return {
    metadata: {
      name: options.name,
      namespace: FEEDS_TAILSCALE_INGRESS.proxyNamespace,
      uid: options.uid,
      resourceVersion: options.resourceVersion,
      labels: options.labels,
      ownerReferences:
        options.controller === undefined
          ? []
          : [
              {
                apiVersion: "apps/v1",
                kind: "StatefulSet",
                name: options.controller.name,
                uid: options.controller.uid,
                controller: true,
              },
            ],
    },
    status: {
      phase: "Running",
      podIP: options.ip,
      podIPs: [{ ip: options.ip }],
      conditions: structuredClone(READY_POD_CONDITIONS),
    },
  };
}

function buildFeedsK8sWorld() {
  const ingressUid = "ing-uid-feeds-1";
  const stsUid = "sts-uid-feeds-1";
  const stsName = "ts-feeds-ingress";
  const verifiedProxyIp = "10.244.0.88";
  const siblingProxyIp = "10.244.0.100";
  const prometheusScraperIp = "10.244.0.42";

  const ingressAnnotations: Record<string, string> = {
    "tailscale.com/tags": "tag:k8s",
  };
  const ingress = {
    metadata: {
      name: FEEDS_TAILSCALE_INGRESS.name,
      namespace: FEEDS_TAILSCALE_INGRESS.namespace,
      uid: ingressUid,
      resourceVersion: "10",
      annotations: ingressAnnotations,
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

  const statefulSetLabels: Record<string, string> = {
    ...FEEDS_TAILSCALE_INGRESS.parentLabels,
  };
  const statefulSet = {
    metadata: {
      name: stsName,
      namespace: FEEDS_TAILSCALE_INGRESS.proxyNamespace,
      uid: stsUid,
      resourceVersion: "20",
      labels: statefulSetLabels,
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

  const feedsProxyPod = makeRunningPod({
    name: `${stsName}-0`,
    uid: "pod-uid-feeds-1",
    resourceVersion: "30",
    ip: verifiedProxyIp,
    labels: { app: ingressUid, ...FEEDS_TAILSCALE_INGRESS.parentLabels },
    controller: { name: stsName, uid: stsUid },
  });

  const siblingProxyPod = makeRunningPod({
    name: "ts-other-ingress-0",
    uid: "pod-uid-other-1",
    resourceVersion: "31",
    ip: siblingProxyIp,
    labels: {
      app: "ing-uid-other",
      "tailscale.com/managed": "true",
      "tailscale.com/parent-resource-type": "ingress",
      "tailscale.com/parent-resource-ns": "other",
      "tailscale.com/parent-resource": "other-ingress",
    },
  });

  const ingressApiPath = `/apis/networking.k8s.io/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.namespace}/ingresses/${FEEDS_TAILSCALE_INGRESS.name}`;
  const podsApiPrefix = `/api/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.proxyNamespace}/pods?`;
  const stsApiPath = `/apis/apps/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.proxyNamespace}/statefulsets/${stsName}`;

  const read: FeedsKubernetesReader = async (requestPath) => {
    if (requestPath === ingressApiPath) {
      return structuredClone(ingress);
    }
    if (requestPath.startsWith(podsApiPrefix)) {
      return { items: structuredClone([feedsProxyPod, siblingProxyPod]) };
    }
    if (requestPath === stsApiPath) {
      return structuredClone(statefulSet);
    }
    throw new Error(`Unexpected Kubernetes path: ${requestPath}`);
  };

  return {
    ingress,
    statefulSet,
    feedsProxyPod,
    siblingProxyPod,
    verifiedProxyIp,
    siblingProxyIp,
    prometheusScraperIp,
    read,
  };
}

describe("FEEDS_TAILSCALE_INGRESS verification", () => {
  test("pins exact Kubernetes Ingress and Tailscale parent coordinates", () => {
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

  test("authorizes only the verified feeds proxy pod IP while keeping machine auth k8s-free", async () => {
    const world = buildFeedsK8sWorld();
    let k8sReads = 0;
    const authConfig = {
      machineToken: "machine-secret",
      operatorLogins: ["shepherdjerred@gmail.com"],
      trustedProxyAddresses: createFeedsTrustedProxyAddresses((reqPath) => {
        k8sReads += 1;
        return world.read(reqPath);
      }),
      publicOrigin: "https://feeds.tailnet-1a49.ts.net",
    };

    const makeOperatorGet = () =>
      new Request("https://feeds.tailnet-1a49.ts.net/api/v1/summary", {
        headers: {
          origin: "https://feeds.tailnet-1a49.ts.net",
          "tailscale-user-login": "shepherdjerred@gmail.com",
        },
      });

    for (const untrustedIp of [
      world.prometheusScraperIp,
      world.siblingProxyIp,
    ]) {
      const denied = await authenticateConsole(
        makeOperatorGet(),
        untrustedIp,
        authConfig,
      );
      expect(denied).toEqual({
        status: 401,
        error: "authenticated private ingress required",
      });
    }

    const allowed = await authenticateConsole(
      makeOperatorGet(),
      world.verifiedProxyIp,
      authConfig,
    );
    expect(allowed).toEqual({
      kind: "human",
      login: "shepherdjerred@gmail.com",
    });

    const readsPriorToMachine = k8sReads;
    const machinePrincipal = authenticateMachine(
      new Request("http://feeds:7430/internal/refresh", {
        method: "POST",
        headers: { authorization: "Bearer machine-secret" },
      }),
      authConfig,
    );
    expect(machinePrincipal).toEqual({ kind: "machine" });
    expect(k8sReads).toBe(readsPriorToMachine);
  });

  test.each([
    [
      "funnel enabled on ingress",
      (w: ReturnType<typeof buildFeedsK8sWorld>) => {
        w.ingress.metadata.annotations["tailscale.com/funnel"] = "true";
      },
    ],
    [
      "proxy pod parent-resource label tampered",
      (w: ReturnType<typeof buildFeedsK8sWorld>) => {
        w.feedsProxyPod.metadata.labels["tailscale.com/parent-resource"] =
          "other-ingress";
      },
    ],
    [
      "duplicate pod IP collision across tailscale namespace",
      (w: ReturnType<typeof buildFeedsK8sWorld>) => {
        w.siblingProxyPod.status.podIP = w.verifiedProxyIp;
      },
    ],
    [
      "StatefulSet parent-resource label tampered",
      (w: ReturnType<typeof buildFeedsK8sWorld>) => {
        w.statefulSet.metadata.labels["tailscale.com/parent-resource"] =
          "other-ingress";
      },
    ],
  ])("fails closed with 503 when %s", async (_scenario, corruptWorld) => {
    const world = buildFeedsK8sWorld();
    corruptWorld(world);
    const resolveProxies = createFeedsTrustedProxyAddresses(world.read);
    await expect(resolveProxies()).rejects.toBeInstanceOf(
      FeedsIngressIdentityError,
    );

    const authResult = await authenticateConsole(
      new Request("https://feeds.tailnet-1a49.ts.net/api/v1/summary", {
        headers: { "tailscale-user-login": "shepherdjerred@gmail.com" },
      }),
      world.verifiedProxyIp,
      {
        machineToken: "machine-secret",
        operatorLogins: ["shepherdjerred@gmail.com"],
        trustedProxyAddresses: resolveProxies,
        publicOrigin: "https://feeds.tailnet-1a49.ts.net",
      },
    );
    expect(authResult).toEqual({
      status: 503,
      error: "private ingress identity could not be verified",
    });
  });

  test("rejects mid-rollout Pod IP drift between the two fence snapshots", async () => {
    const world = buildFeedsK8sWorld();
    let podListCalls = 0;
    const racingResolver = createFeedsTrustedProxyAddresses((reqPath) => {
      if (reqPath.includes("/pods?")) {
        podListCalls += 1;
        if (podListCalls > 1) {
          world.feedsProxyPod.status.podIP = "10.244.0.89";
          world.feedsProxyPod.status.podIPs = [{ ip: "10.244.0.89" }];
        }
      }
      return world.read(reqPath);
    });
    await expect(racingResolver()).rejects.toBeInstanceOf(
      FeedsIngressIdentityError,
    );
  });
});
