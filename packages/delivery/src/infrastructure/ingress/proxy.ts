import { isIP } from "node:net";
import { z } from "zod";
import { DELIVERY_TAILSCALE_INGRESS as target } from "@shepherdjerred/ops-model/delivery-ingress.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  readIngressKubernetes,
  type IngressKubernetesReader,
} from "./kubernetes.ts";

const Name = z.string().regex(/^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/u);
const Labels = z.record(z.string(), z.string());
const Metadata = z.looseObject({
  name: Name,
  namespace: Name,
  uid: z.string().min(1),
  resourceVersion: z.string().min(1),
  deletionTimestamp: z.string().nullable().optional(),
  labels: Labels.default({}),
});
const Ingress = z.looseObject({
  metadata: Metadata.extend({ annotations: Labels.default({}) }),
  spec: z.looseObject({
    ingressClassName: z.literal("tailscale"),
    defaultBackend: z.looseObject({
      service: z.looseObject({
        name: z.literal("delivery"),
        port: z.object({ number: z.literal(7353) }),
      }),
    }),
    tls: z.tuple([z.looseObject({ hosts: z.tuple([z.literal("delivery")]) })]),
    rules: z.array(z.unknown()).max(0).optional(),
  }),
});
const Pod = z.looseObject({
  metadata: Metadata.extend({
    ownerReferences: z
      .array(
        z.looseObject({
          apiVersion: z.string(),
          kind: z.string(),
          name: Name,
          uid: z.string().min(1),
          controller: z.boolean().optional(),
        }),
      )
      .default([]),
  }),
  status: z
    .looseObject({
      phase: z.string().optional(),
      podIP: z.string().optional(),
      podIPs: z.array(z.object({ ip: z.string() })).optional(),
      conditions: z
        .array(z.looseObject({ type: z.string(), status: z.string() }))
        .default([]),
    })
    .default({ conditions: [] }),
});
const PodList = z.looseObject({
  metadata: z.looseObject({ continue: z.string().optional() }),
  items: z.array(Pod).max(1000),
});
const StatefulSet = z.looseObject({
  metadata: Metadata,
  spec: z.looseObject({
    selector: z.object({
      matchLabels: Labels,
      matchExpressions: z.array(z.unknown()).max(0).optional(),
    }),
    template: z.looseObject({ metadata: z.looseObject({ labels: Labels }) }),
  }),
});
const parentMatches = (labels: Record<string, string>) =>
  Object.entries(target.parentLabels).every(
    ([key, value]) => labels[key] === value,
  );
const requireIdentity = (condition: boolean) => {
  if (!condition)
    throw new DeliveryError(
      "PAUSED",
      "Current private ingress proxy identity could not be verified; retry after the operator reconciles its Ingress and ready Pods",
    );
};
const live = (metadata: z.infer<typeof Metadata>) =>
  metadata.deletionTimestamp === undefined ||
  metadata.deletionTimestamp === null;
const sortedLabels = (labels: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)),
  );

function verifyController(input: {
  controller: z.infer<typeof StatefulSet>;
  owner: { name: string; uid: string };
  pod: z.infer<typeof Pod>;
  ingressUid: string;
}) {
  const { controller, owner, pod, ingressUid } = input;
  requireIdentity(
    controller.metadata.name === owner.name &&
      controller.metadata.namespace === target.proxyNamespace &&
      controller.metadata.uid === owner.uid &&
      live(controller.metadata) &&
      parentMatches(controller.metadata.labels) &&
      controller.spec.selector.matchLabels["app"] === ingressUid &&
      controller.spec.template.metadata.labels["app"] === ingressUid &&
      parentMatches(controller.spec.template.metadata.labels),
  );
  requireIdentity(
    Object.entries(controller.spec.selector.matchLabels).every(
      ([key, value]) => pod.metadata.labels[key] === value,
    ),
  );
}

async function observe(read: IngressKubernetesReader) {
  const [rawIngress, rawPods] = await Promise.all([
    read(
      `/apis/networking.k8s.io/v1/namespaces/${target.namespace}/ingresses/${target.name}`,
    ),
    read(`/api/v1/namespaces/${target.proxyNamespace}/pods?limit=1000`),
  ]);
  const ingress = Ingress.parse(rawIngress),
    pods = PodList.parse(rawPods);
  requireIdentity(
    ingress.metadata.name === target.name &&
      ingress.metadata.namespace === target.namespace &&
      live(ingress.metadata) &&
      (pods.metadata.continue === undefined || pods.metadata.continue === "") &&
      ingress.metadata.annotations["tailscale.com/funnel"] !== "true",
  );
  const allAddresses = new Map<string, string>();
  for (const pod of pods.items) {
    requireIdentity(pod.metadata.namespace === target.proxyNamespace);
    const addresses = new Set(
      [
        pod.status.podIP,
        ...(pod.status.podIPs ?? []).map((value) => value.ip),
      ].filter((value) => value !== undefined),
    );
    for (const address of addresses) {
      requireIdentity(isIP(address) !== 0 && !allAddresses.has(address));
      allAddresses.set(address, pod.metadata.uid);
    }
  }
  const candidates = pods.items.filter((pod) =>
    parentMatches(pod.metadata.labels),
  );
  const ready = candidates.filter(
    (pod) =>
      live(pod.metadata) &&
      pod.status.phase === "Running" &&
      ["Ready", "ContainersReady"].every((type) =>
        pod.status.conditions.some(
          (condition) => condition.type === type && condition.status === "True",
        ),
      ),
  );
  requireIdentity(ready.length > 0);
  const identities = [];
  const owners = new Set<string>();
  for (const pod of ready) {
    requireIdentity(pod.metadata.labels["app"] === ingress.metadata.uid);
    const controllers = pod.metadata.ownerReferences.filter(
      (owner) => owner.controller === true,
    );
    const owner = controllers[0];
    requireIdentity(
      controllers.length === 1 &&
        owner?.apiVersion === "apps/v1" &&
        owner.kind === "StatefulSet",
    );
    if (owner === undefined)
      throw new Error("Missing checked StatefulSet owner");
    const controller = StatefulSet.parse(
      await read(
        `/apis/apps/v1/namespaces/${target.proxyNamespace}/statefulsets/${encodeURIComponent(owner.name)}`,
      ),
    );
    verifyController({
      controller,
      owner,
      pod,
      ingressUid: ingress.metadata.uid,
    });
    const address = pod.status.podIP;
    requireIdentity(address !== undefined && isIP(address) !== 0);
    owners.add(owner.uid);
    identities.push({
      pod: {
        uid: pod.metadata.uid,
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
      },
      address,
      ready: true,
      controller: {
        uid: controller.metadata.uid,
        name: controller.metadata.name,
        selector: sortedLabels(controller.spec.selector.matchLabels),
      },
    });
  }
  requireIdentity(owners.size === 1);
  identities.sort((a, b) => a.pod.uid.localeCompare(b.pod.uid));
  return {
    ingress: {
      uid: ingress.metadata.uid,
      namespace: ingress.metadata.namespace,
      name: ingress.metadata.name,
      ingressClassName: ingress.spec.ingressClassName,
      backend: ingress.spec.defaultBackend.service,
      tls: ingress.spec.tls,
      tags: ingress.metadata.annotations["tailscale.com/tags"] ?? "",
      funnel: ingress.metadata.annotations["tailscale.com/funnel"] ?? "",
    },
    identities,
  };
}

/** No cached addresses: fence the current Ingress UID, owner chain and ready Pod IP twice for each human request. */
export function createTrustedProxyAddresses(
  read: IngressKubernetesReader = readIngressKubernetes,
) {
  return async (): Promise<string[]> => {
    try {
      const before = await observe(read),
        after = await observe(read);
      requireIdentity(JSON.stringify(before) === JSON.stringify(after));
      return after.identities.map((identity) =>
        z.string().parse(identity.address),
      );
    } catch (error) {
      if (error instanceof DeliveryError) throw error;
      throw new DeliveryError(
        "PAUSED",
        "Private ingress identity verification returned invalid or unavailable Kubernetes metadata",
      );
    }
  };
}
