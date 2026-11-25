import { isIP } from "node:net";
import { z } from "zod";

/** Fixed operator-owned human ingress; verified independently on each human request. */
export const FEEDS_TAILSCALE_INGRESS = {
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
} as const;

export type FeedsKubernetesReader = (path: string) => Promise<unknown>;

export class FeedsIngressIdentityError extends Error {
  override readonly name = "FeedsIngressIdentityError";
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_POD_ITEMS = 1000;
const POD_LIST_LIMIT = 50;
const KUBE_DNS_NAME = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/u;
const StringMap = z.record(z.string(), z.string());
const CodedFailure = z.object({ code: z.string() });

function kubeObjectHeader() {
  return z.looseObject({
    name: z.string().regex(KUBE_DNS_NAME),
    namespace: z.string().regex(KUBE_DNS_NAME),
    uid: z.string().min(1),
    resourceVersion: z.string().min(1),
    deletionTimestamp: z.string().nullable().optional(),
    labels: StringMap.default({}),
  });
}

const FeedsIngressDocument = z.looseObject({
  metadata: kubeObjectHeader().extend({ annotations: StringMap.default({}) }),
  spec: z.looseObject({
    ingressClassName: z.literal("tailscale"),
    defaultBackend: z.looseObject({
      service: z.looseObject({
        name: z.literal(FEEDS_TAILSCALE_INGRESS.serviceName),
        port: z.object({ number: z.literal(FEEDS_TAILSCALE_INGRESS.port) }),
      }),
    }),
    tls: z.tuple([
      z.looseObject({
        hosts: z.tuple([z.literal(FEEDS_TAILSCALE_INGRESS.host)]),
      }),
    ]),
    rules: z.array(z.unknown()).max(0).optional(),
  }),
});

const ProxyControllerOwner = z.looseObject({
  apiVersion: z.string(),
  kind: z.string(),
  name: z.string().regex(KUBE_DNS_NAME),
  uid: z.string().min(1),
  controller: z.boolean().optional(),
});

const PodConditionEntry = z.looseObject({
  type: z.string(),
  status: z.string(),
});

const PodIpEntry = z.object({ ip: z.string() });

const PodRuntimeStatus = z.looseObject({
  conditions: z.array(PodConditionEntry).default([]),
  podIPs: z.array(PodIpEntry).optional(),
  podIP: z.string().optional(),
  phase: z.string().optional(),
});

const ProxyPodDocument = z.looseObject({
  metadata: kubeObjectHeader().extend({
    ownerReferences: z.array(ProxyControllerOwner).default([]),
  }),
  status: PodRuntimeStatus.optional(),
});

const ProxyStatefulSetDocument = z.looseObject({
  metadata: kubeObjectHeader(),
  spec: z.looseObject({
    selector: z.object({
      matchLabels: StringMap,
      matchExpressions: z.array(z.unknown()).max(0).optional(),
    }),
    template: z.looseObject({
      metadata: z.looseObject({ labels: StringMap }),
    }),
  }),
});

const PodListPage = z.looseObject({
  metadata: z.looseObject({ continue: z.string().optional() }).optional(),
  items: z.array(z.record(z.string(), z.unknown())),
});

function failVerification(reason: string): never {
  throw new FeedsIngressIdentityError(reason);
}

function assertVerified(condition: boolean): void {
  if (!condition) {
    failVerification("private ingress identity could not be verified");
  }
}

function isActiveResource(meta: {
  readonly deletionTimestamp?: string | null | undefined;
}): boolean {
  return (
    meta.deletionTimestamp === undefined || meta.deletionTimestamp === null
  );
}

function hasParentLabels(labels: Readonly<Record<string, string>>): boolean {
  for (const [key, expected] of Object.entries(
    FEEDS_TAILSCALE_INGRESS.parentLabels,
  )) {
    if (labels[key] !== expected) return false;
  }
  return true;
}

async function readBoundedText(
  response: Response,
  bound: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > bound) {
    throw new Error("RESPONSE_TOO_LARGE");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > bound) {
        await reader.cancel();
        throw new Error("RESPONSE_TOO_LARGE");
      }
      parts.push(decoder.decode(step.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    reader.releaseLock();
  }
}

/** Lazy projected, read-only identity. Health, reader, and bearer requests never load Kubernetes credentials. */
export function createProjectedFeedsKubernetesReader(
  directory: string = FEEDS_TAILSCALE_INGRESS.directory,
  bound: number = MAX_RESPONSE_BYTES,
): FeedsKubernetesReader {
  return async (path) => {
    try {
      const [token, ca] = await Promise.all([
        Bun.file(`${directory}/token`).text(),
        Bun.file(`${directory}/ca.crt`).text(),
      ]);
      const response = await fetch(
        new URL(path, "https://kubernetes.default.svc"),
        {
          headers: { authorization: `Bearer ${token.trim()}` },
          tls: { ca },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (response.status !== 200) {
        throw new Error(`KUBE_HTTP_${String(response.status)}`);
      }
      const rawText = await readBoundedText(response, bound);
      const decoded: unknown = JSON.parse(rawText);
      return decoded;
    } catch (error) {
      const coded = CodedFailure.safeParse(error);
      console.error(
        JSON.stringify({
          message: "feeds_kubernetes_read_failed",
          service: "feeds",
          path: path.split("?", 1)[0] ?? path,
          errorType: error instanceof Error ? error.name : typeof error,
          ...(coded.success ? { code: coded.data.code } : {}),
        }),
      );
      return failVerification(
        "private ingress identity verification unavailable",
      );
    }
  };
}

async function collectProxyNamespacePods(
  read: FeedsKubernetesReader,
): Promise<z.infer<typeof ProxyPodDocument>[]> {
  const endpoint = `/api/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.proxyNamespace}/pods`;
  const rawItems: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ limit: String(POD_LIST_LIMIT) });
    if (cursor !== undefined) params.set("continue", cursor);
    const page = PodListPage.parse(
      await read(`${endpoint}?${params.toString()}`),
    );
    rawItems.push(...page.items);
    if (rawItems.length > MAX_POD_ITEMS) {
      failVerification("private ingress identity verification unavailable");
    }
    const nextCursor = page.metadata?.continue;
    cursor =
      nextCursor === undefined || nextCursor.length === 0
        ? undefined
        : nextCursor;
  } while (cursor !== undefined);
  return z.array(ProxyPodDocument).max(MAX_POD_ITEMS).parse(rawItems);
}

function isReadyProxyCandidate(pod: z.infer<typeof ProxyPodDocument>): boolean {
  if (!hasParentLabels(pod.metadata.labels)) return false;
  if (!isActiveResource(pod.metadata) || pod.status?.phase !== "Running") {
    return false;
  }
  const trueConditions = new Set(
    pod.status.conditions
      .filter((entry) => entry.status === "True")
      .map((entry) => entry.type),
  );
  return trueConditions.has("Ready") && trueConditions.has("ContainersReady");
}

function assertUniqueNamespaceAddresses(
  pods: readonly z.infer<typeof ProxyPodDocument>[],
): void {
  const seenIps = new Set<string>();
  for (const pod of pods) {
    assertVerified(
      pod.metadata.namespace === FEEDS_TAILSCALE_INGRESS.proxyNamespace,
    );
    const podAddresses = new Set<string>();
    if (pod.status?.podIP !== undefined) podAddresses.add(pod.status.podIP);
    for (const entry of pod.status?.podIPs ?? []) podAddresses.add(entry.ip);
    for (const ip of podAddresses) {
      assertVerified(isIP(ip) !== 0 && !seenIps.has(ip));
      seenIps.add(ip);
    }
  }
}

async function verifyProxyPodController(
  read: FeedsKubernetesReader,
  pod: z.infer<typeof ProxyPodDocument>,
  ingressUid: string,
): Promise<{
  readonly podUid: string;
  readonly address: string;
  readonly controllerUid: string;
  readonly selectorEntries: readonly (readonly [string, string])[];
}> {
  assertVerified(pod.metadata.labels["app"] === ingressUid);
  const controllers = pod.metadata.ownerReferences.filter(
    (ref) => ref.controller === true,
  );
  const primaryOwner = controllers[0];
  if (
    controllers.length !== 1 ||
    primaryOwner?.apiVersion !== "apps/v1" ||
    primaryOwner.kind !== "StatefulSet"
  ) {
    failVerification("private ingress identity could not be verified");
  }
  const statefulSet = ProxyStatefulSetDocument.parse(
    await read(
      `/apis/apps/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.proxyNamespace}/statefulsets/${encodeURIComponent(primaryOwner.name)}`,
    ),
  );
  const selectorLabels = statefulSet.spec.selector.matchLabels;
  const templateLabels = statefulSet.spec.template.metadata.labels;
  assertVerified(
    statefulSet.metadata.name === primaryOwner.name &&
      statefulSet.metadata.namespace ===
        FEEDS_TAILSCALE_INGRESS.proxyNamespace &&
      statefulSet.metadata.uid === primaryOwner.uid &&
      isActiveResource(statefulSet.metadata) &&
      hasParentLabels(statefulSet.metadata.labels) &&
      selectorLabels["app"] === ingressUid &&
      templateLabels["app"] === ingressUid &&
      hasParentLabels(templateLabels) &&
      Object.entries(selectorLabels).every(
        ([key, expected]) => pod.metadata.labels[key] === expected,
      ),
  );
  const address = pod.status?.podIP;
  if (address === undefined || isIP(address) === 0) {
    failVerification("private ingress identity could not be verified");
  }
  return {
    podUid: pod.metadata.uid,
    address,
    controllerUid: statefulSet.metadata.uid,
    selectorEntries: Object.entries(selectorLabels).toSorted(([a], [b]) =>
      a.localeCompare(b),
    ),
  };
}

async function snapshotProxyState(read: FeedsKubernetesReader) {
  const ingressPath = `/apis/networking.k8s.io/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.namespace}/ingresses/${FEEDS_TAILSCALE_INGRESS.name}`;
  const [rawIngress, pods] = await Promise.all([
    read(ingressPath),
    collectProxyNamespacePods(read),
  ]);
  const ingress = FeedsIngressDocument.parse(rawIngress);
  assertVerified(
    ingress.metadata.name === FEEDS_TAILSCALE_INGRESS.name &&
      ingress.metadata.namespace === FEEDS_TAILSCALE_INGRESS.namespace &&
      isActiveResource(ingress.metadata) &&
      ingress.metadata.annotations["tailscale.com/funnel"] !== "true",
  );
  assertUniqueNamespaceAddresses(pods);
  const readyPods = pods.filter((pod) => isReadyProxyCandidate(pod));
  assertVerified(readyPods.length > 0);
  const verified = await Promise.all(
    readyPods.map((pod) =>
      verifyProxyPodController(read, pod, ingress.metadata.uid),
    ),
  );
  const controllerUids = new Set(verified.map((item) => item.controllerUid));
  assertVerified(controllerUids.size === 1);
  return {
    ingressUid: ingress.metadata.uid,
    tags: ingress.metadata.annotations["tailscale.com/tags"] ?? "",
    proxies: verified.toSorted((a, b) => a.podUid.localeCompare(b.podUid)),
  };
}

/** Fence the current Ingress UID, owner chain, and ready proxy Pod IP twice for each human request. */
export function createFeedsTrustedProxyAddresses(
  read: FeedsKubernetesReader = createProjectedFeedsKubernetesReader(),
): () => Promise<readonly string[]> {
  return async () => {
    try {
      const first = await snapshotProxyState(read);
      const second = await snapshotProxyState(read);
      assertVerified(Bun.deepEquals(first, second));
      return second.proxies.map((proxy) => proxy.address);
    } catch (error) {
      if (error instanceof FeedsIngressIdentityError) throw error;
      return failVerification(
        "private ingress identity verification unavailable",
      );
    }
  };
}
