import { isIP } from "node:net";
import { z } from "zod";
import { readResponseStreamBounded } from "./ssrf.ts";

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

const K8S_RESPONSE_BYTE_CAP = 1024 * 1024;
const PROXY_NAMESPACE_POD_CAP = 1000;
const PROXY_POD_PAGE_LIMIT = 50;
const DNS_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/u;
const VERIFICATION_FAILED_MESSAGE =
  "private ingress identity could not be verified";
const VERIFICATION_UNAVAILABLE_MESSAGE =
  "private ingress identity verification unavailable";

const LabelRecordSchema = z.record(z.string(), z.string());
const ErrorWithCodeSchema = z.object({ code: z.string() });

const ResourceMetadataSchema = z.looseObject({
  name: z.string().regex(DNS_SUBDOMAIN_PATTERN),
  namespace: z.string().regex(DNS_SUBDOMAIN_PATTERN),
  uid: z.string().min(1),
  resourceVersion: z.string().min(1),
  deletionTimestamp: z.string().nullable().optional(),
  labels: LabelRecordSchema.default({}),
});

const TailscaleIngressResourceSchema = z.looseObject({
  metadata: ResourceMetadataSchema.extend({
    annotations: LabelRecordSchema.default({}),
  }),
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

const OwnerRefSchema = z.looseObject({
  apiVersion: z.string(),
  kind: z.string(),
  name: z.string().regex(DNS_SUBDOMAIN_PATTERN),
  uid: z.string().min(1),
  controller: z.boolean().optional(),
});

const PodConditionItemSchema = z.looseObject({
  type: z.string(),
  status: z.string(),
});

const PodAddressItemSchema = z.object({ ip: z.string() });

const NormalizedPodStatusSchema = z
  .looseObject({
    conditions: z.array(PodConditionItemSchema).optional(),
    phase: z.string().optional(),
    podIP: z.string().optional(),
    podIPs: z.array(PodAddressItemSchema).optional(),
  })
  .transform((raw) => {
    const uniqueIps = new Set<string>();
    if (raw.podIP !== undefined) {
      uniqueIps.add(raw.podIP);
    }
    for (const entry of raw.podIPs ?? []) {
      uniqueIps.add(entry.ip);
    }
    const trueTypes = new Set(
      (raw.conditions ?? [])
        .filter((item) => item.status === "True")
        .map((item) => item.type),
    );
    return {
      primaryIp: raw.podIP,
      allIps: [...uniqueIps],
      runningAndReady:
        raw.phase === "Running" &&
        trueTypes.has("Ready") &&
        trueTypes.has("ContainersReady"),
    };
  });

const TailscalePodResourceSchema = z.looseObject({
  metadata: ResourceMetadataSchema.extend({
    ownerReferences: z.array(OwnerRefSchema).default([]),
  }),
  status: NormalizedPodStatusSchema.optional(),
});

const TailscaleStatefulSetSchema = z.looseObject({
  metadata: ResourceMetadataSchema,
  spec: z.looseObject({
    selector: z.object({
      matchLabels: LabelRecordSchema,
      matchExpressions: z.array(z.unknown()).max(0).optional(),
    }),
    template: z.looseObject({
      metadata: z.looseObject({ labels: LabelRecordSchema }),
    }),
  }),
});

const PaginatedPodListSchema = z.looseObject({
  metadata: z.looseObject({ continue: z.string().optional() }).optional(),
  items: z.array(z.record(z.string(), z.unknown())),
});

type TailscalePodResource = z.infer<typeof TailscalePodResourceSchema>;
type VerifiedProxyIdentity = {
  readonly podUid: string;
  readonly address: string;
  readonly controllerUid: string;
  readonly selectorFingerprint: string;
};

function requireInvariant(
  ok: boolean,
  message = VERIFICATION_FAILED_MESSAGE,
): void {
  if (!ok) {
    throw new FeedsIngressIdentityError(message);
  }
}

function isNonDeleting(meta: {
  readonly deletionTimestamp?: string | null | undefined;
}): boolean {
  return (
    meta.deletionTimestamp === undefined || meta.deletionTimestamp === null
  );
}

function matchesFeedsParentLabels(
  labels: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(FEEDS_TAILSCALE_INGRESS.parentLabels).every(
    ([labelKey, expectedValue]) => labels[labelKey] === expectedValue,
  );
}

/** Lazy projected, read-only identity. Health, reader, and bearer requests never load Kubernetes credentials. */
export function createProjectedFeedsKubernetesReader(
  directory: string = FEEDS_TAILSCALE_INGRESS.directory,
  bound: number = K8S_RESPONSE_BYTE_CAP,
): FeedsKubernetesReader {
  return async (resourcePath) => {
    try {
      const [rawToken, caBundle] = await Promise.all([
        Bun.file(`${directory}/token`).text(),
        Bun.file(`${directory}/ca.crt`).text(),
      ]);
      const kubeResponse = await fetch(
        new URL(resourcePath, "https://kubernetes.default.svc"),
        {
          headers: { authorization: `Bearer ${rawToken.trim()}` },
          tls: { ca: caBundle },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (kubeResponse.status !== 200) {
        throw new Error(`KUBE_HTTP_${String(kubeResponse.status)}`);
      }
      const payload = await readResponseStreamBounded(kubeResponse, bound);
      return JSON.parse(payload) as unknown;
    } catch (error) {
      const maybeCoded = ErrorWithCodeSchema.safeParse(error);
      console.error(
        JSON.stringify({
          message: "feeds_kubernetes_read_failed",
          service: "feeds",
          path: resourcePath.split("?", 1)[0] ?? resourcePath,
          errorType: error instanceof Error ? error.name : typeof error,
          ...(maybeCoded.success ? { code: maybeCoded.data.code } : {}),
        }),
      );
      throw new FeedsIngressIdentityError(VERIFICATION_UNAVAILABLE_MESSAGE);
    }
  };
}

async function listAllProxyNamespacePods(
  readK8s: FeedsKubernetesReader,
): Promise<TailscalePodResource[]> {
  const collected: Record<string, unknown>[] = [];
  let continuation: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ limit: String(PROXY_POD_PAGE_LIMIT) });
    if (continuation !== undefined) {
      query.set("continue", continuation);
    }
    const rawPage = await readK8s(
      `/api/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.proxyNamespace}/pods?${query.toString()}`,
    );
    const page = PaginatedPodListSchema.parse(rawPage);
    collected.push(...page.items);
    requireInvariant(
      collected.length <= PROXY_NAMESPACE_POD_CAP,
      VERIFICATION_UNAVAILABLE_MESSAGE,
    );
    const nextToken = page.metadata?.continue;
    if (nextToken === undefined || nextToken.length === 0) {
      break;
    }
    continuation = nextToken;
  }
  return z
    .array(TailscalePodResourceSchema)
    .max(PROXY_NAMESPACE_POD_CAP)
    .parse(collected);
}

function validateDisjointNamespacePodIps(
  pods: readonly TailscalePodResource[],
): void {
  const claimedAddresses = new Set<string>();
  for (const pod of pods) {
    requireInvariant(
      pod.metadata.namespace === FEEDS_TAILSCALE_INGRESS.proxyNamespace,
    );
    for (const ip of pod.status?.allIps ?? []) {
      requireInvariant(isIP(ip) !== 0 && !claimedAddresses.has(ip));
      claimedAddresses.add(ip);
    }
  }
}

function isEligibleFeedsProxyPod(pod: TailscalePodResource): boolean {
  return (
    matchesFeedsParentLabels(pod.metadata.labels) &&
    isNonDeleting(pod.metadata) &&
    pod.status?.runningAndReady === true
  );
}

async function resolveVerifiedPodIdentity(
  readK8s: FeedsKubernetesReader,
  pod: TailscalePodResource,
  expectedIngressUid: string,
): Promise<VerifiedProxyIdentity> {
  requireInvariant(pod.metadata.labels["app"] === expectedIngressUid);
  const controllerRefs = pod.metadata.ownerReferences.filter(
    (entry) => entry.controller === true,
  );
  const owner = controllerRefs[0];
  if (
    controllerRefs.length !== 1 ||
    owner?.apiVersion !== "apps/v1" ||
    owner.kind !== "StatefulSet"
  ) {
    throw new FeedsIngressIdentityError(VERIFICATION_FAILED_MESSAGE);
  }
  const rawSts = await readK8s(
    `/apis/apps/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.proxyNamespace}/statefulsets/${encodeURIComponent(owner.name)}`,
  );
  const sts = TailscaleStatefulSetSchema.parse(rawSts);
  const selector = sts.spec.selector.matchLabels;
  const podTemplateLabels = sts.spec.template.metadata.labels;
  const controllerMatches =
    sts.metadata.name === owner.name &&
    sts.metadata.namespace === FEEDS_TAILSCALE_INGRESS.proxyNamespace &&
    sts.metadata.uid === owner.uid &&
    isNonDeleting(sts.metadata) &&
    matchesFeedsParentLabels(sts.metadata.labels) &&
    selector["app"] === expectedIngressUid &&
    podTemplateLabels["app"] === expectedIngressUid &&
    matchesFeedsParentLabels(podTemplateLabels) &&
    Object.entries(selector).every(
      ([labelKey, labelValue]) => pod.metadata.labels[labelKey] === labelValue,
    );
  requireInvariant(controllerMatches);

  const podAddress = pod.status?.primaryIp;
  if (podAddress === undefined || isIP(podAddress) === 0) {
    throw new FeedsIngressIdentityError(VERIFICATION_FAILED_MESSAGE);
  }
  const selectorFingerprint = JSON.stringify(
    Object.entries(selector).toSorted(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return {
    podUid: pod.metadata.uid,
    address: podAddress,
    controllerUid: sts.metadata.uid,
    selectorFingerprint,
  };
}

async function readFencedClusterSnapshot(readK8s: FeedsKubernetesReader) {
  const ingressEndpoint = `/apis/networking.k8s.io/v1/namespaces/${FEEDS_TAILSCALE_INGRESS.namespace}/ingresses/${FEEDS_TAILSCALE_INGRESS.name}`;
  const [ingressPayload, namespacePods] = await Promise.all([
    readK8s(ingressEndpoint),
    listAllProxyNamespacePods(readK8s),
  ]);
  const ingress = TailscaleIngressResourceSchema.parse(ingressPayload);
  requireInvariant(
    ingress.metadata.name === FEEDS_TAILSCALE_INGRESS.name &&
      ingress.metadata.namespace === FEEDS_TAILSCALE_INGRESS.namespace &&
      isNonDeleting(ingress.metadata) &&
      ingress.metadata.annotations["tailscale.com/funnel"] !== "true",
  );

  validateDisjointNamespacePodIps(namespacePods);
  const candidates = namespacePods.filter((pod) =>
    isEligibleFeedsProxyPod(pod),
  );
  requireInvariant(candidates.length > 0);

  const verifiedProxies = await Promise.all(
    candidates.map((pod) =>
      resolveVerifiedPodIdentity(readK8s, pod, ingress.metadata.uid),
    ),
  );
  const uniqueControllers = new Set(
    verifiedProxies.map((entry) => entry.controllerUid),
  );
  requireInvariant(uniqueControllers.size === 1);

  return {
    ingressUid: ingress.metadata.uid,
    tagsAnnotation: ingress.metadata.annotations["tailscale.com/tags"] ?? "",
    proxies: verifiedProxies.toSorted((left, right) =>
      left.podUid.localeCompare(right.podUid),
    ),
  };
}

/** Fence the current Ingress UID, owner chain, and ready proxy Pod IP twice for each human request. */
export function createFeedsTrustedProxyAddresses(
  read: FeedsKubernetesReader = createProjectedFeedsKubernetesReader(),
): () => Promise<readonly string[]> {
  return async () => {
    try {
      const before = await readFencedClusterSnapshot(read);
      const after = await readFencedClusterSnapshot(read);
      requireInvariant(Bun.deepEquals(before, after));
      return after.proxies.map((entry) => entry.address);
    } catch (error) {
      if (error instanceof FeedsIngressIdentityError) {
        throw error;
      }
      throw new FeedsIngressIdentityError(VERIFICATION_UNAVAILABLE_MESSAGE);
    }
  };
}
