import { DELIVERY_TAILSCALE_INGRESS as target } from "@shepherdjerred/ops-model/delivery-ingress.ts";

export function ingressFixture() {
  const metadata = (
    name: string,
    namespace: string,
    uid: string,
    labels: Record<string, string>,
  ): {
    name: string;
    namespace: string;
    uid: string;
    resourceVersion: string;
    labels: Record<string, string>;
    deletionTimestamp: string | null;
  } => ({
    name,
    namespace,
    uid,
    resourceVersion: "1",
    labels,
    deletionTimestamp: null,
  });
  const labels = { ...target.parentLabels, app: "ingress-uid" };
  const annotations: Record<string, string> = {};
  const ingress = {
    metadata: {
      ...metadata(target.name, target.namespace, "ingress-uid", {}),
      annotations,
    },
    spec: {
      ingressClassName: "tailscale",
      defaultBackend: { service: { name: "delivery", port: { number: 7353 } } },
      tls: [{ hosts: ["delivery"] }],
    },
  };
  const controller = {
    metadata: metadata("ts-delivery", target.proxyNamespace, "sts-uid", {
      ...target.parentLabels,
    }),
    spec: {
      selector: { matchLabels: { app: "ingress-uid" } },
      template: { metadata: { labels: { ...labels } } },
    },
  };
  const pod = {
    metadata: {
      ...metadata("ts-delivery-0", target.proxyNamespace, "pod-uid", {
        ...labels,
      }),
      ownerReferences: [
        {
          apiVersion: "apps/v1",
          kind: "StatefulSet",
          name: "ts-delivery",
          uid: "sts-uid",
          controller: true,
        },
      ],
    },
    status: {
      phase: "Running",
      podIP: "10.244.0.72",
      podIPs: [{ ip: "10.244.0.72" }],
      conditions: [
        { type: "Ready", status: "True" },
        { type: "ContainersReady", status: "True" },
      ],
    },
  };
  const pods = { metadata: { continue: "" }, items: [pod] };
  const read = (path: string): Promise<unknown> => {
    if (
      path ===
      `/apis/networking.k8s.io/v1/namespaces/${target.namespace}/ingresses/${target.name}`
    )
      return Promise.resolve(structuredClone(ingress));
    if (path === `/api/v1/namespaces/${target.proxyNamespace}/pods?limit=1000`)
      return Promise.resolve(structuredClone(pods));
    if (
      path ===
      `/apis/apps/v1/namespaces/${target.proxyNamespace}/statefulsets/ts-delivery`
    )
      return Promise.resolve(structuredClone(controller));
    throw new Error("Unexpected native read");
  };
  return { ingress, controller, pod, pods, read };
}
