import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { z } from "zod";

/** Fixed operator-owned human ingress; verified independently on each human request. */
export const FLAGS_TAILSCALE_INGRESS = {
  namespace: "flags",
  name: "flags-flags-ingress-ingress",
  proxyNamespace: "tailscale",
  serviceName: "flags",
  port: 7360,
  host: "flags",
  directory: "/var/run/flags-ingress",
  parentLabels: {
    "tailscale.com/managed": "true",
    "tailscale.com/parent-resource-type": "ingress",
    "tailscale.com/parent-resource-ns": "flags",
    "tailscale.com/parent-resource": "flags-flags-ingress-ingress",
  },
} as const;

export type FlagsKubernetesReader = (path: string) => Promise<unknown>;

export class FlagsIngressIdentityError extends Error {
  override readonly name = "FlagsIngressIdentityError";
}

const KUBERNETES_RESPONSE_BOUND = 1024 * 1024;
const MAX_PROXY_PODS = 1000;
const PROXY_POD_PAGE = 50;
const CodedErrorSchema = z.object({ code: z.string() });
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
const IngressSchema = z.looseObject({
  metadata: Metadata.extend({ annotations: Labels.default({}) }),
  spec: z.looseObject({
    ingressClassName: z.literal("tailscale"),
    defaultBackend: z.looseObject({
      service: z.looseObject({
        name: z.literal(FLAGS_TAILSCALE_INGRESS.serviceName),
        port: z.object({ number: z.literal(FLAGS_TAILSCALE_INGRESS.port) }),
      }),
    }),
    tls: z.tuple([
      z.looseObject({
        hosts: z.tuple([z.literal(FLAGS_TAILSCALE_INGRESS.host)]),
      }),
    ]),
    rules: z.array(z.unknown()).max(0).optional(),
  }),
});
const PodSchema = z.looseObject({
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
const PodsSchema = z.array(PodSchema).max(MAX_PROXY_PODS);
const StatefulSetSchema = z.looseObject({
  metadata: Metadata,
  spec: z.looseObject({
    selector: z.object({
      matchLabels: Labels,
      matchExpressions: z.array(z.unknown()).max(0).optional(),
    }),
    template: z.looseObject({ metadata: z.looseObject({ labels: Labels }) }),
  }),
});
const PageSchema = z.looseObject({
  metadata: z.looseObject({ continue: z.string().optional() }).optional(),
  items: z.array(z.record(z.string(), z.unknown())),
});

function readTarget(path: string): string {
  return path.split("?", 1)[0] ?? path;
}

function reportFailedRead(path: string, error: unknown): void {
  const coded = CodedErrorSchema.safeParse(error);
  console.error(
    JSON.stringify({
      message: "flags_kubernetes_read_failed",
      service: "flags",
      path: readTarget(path),
      errorType: error instanceof Error ? error.name : typeof error,
      ...(coded.success ? { code: coded.data.code } : {}),
    }),
  );
}

/** Lazy projected, read-only identity. Health, evaluation, and bearer requests never load Kubernetes credentials. */
export function createProjectedFlagsKubernetesReader(
  directory: string = FLAGS_TAILSCALE_INGRESS.directory,
  bound: number = KUBERNETES_RESPONSE_BOUND,
): FlagsKubernetesReader {
  return async (path) => {
    try {
      const [token, ca] = await Promise.all([
        readFile(`${directory}/token`, "utf8"),
        readFile(`${directory}/ca.crt`, "utf8"),
      ]);
      const bytes = await new Promise<Buffer | null>((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const child = request(
          new URL(path, "https://kubernetes.default.svc"),
          { ca, headers: { Authorization: `Bearer ${token.trim()}` } },
          (response) => {
            if (response.statusCode === 404) {
              response.resume();
              resolve(null);
              return;
            }
            if (response.statusCode !== 200) {
              response.resume();
              reject(new Error(`HTTP_${String(response.statusCode ?? 0)}`));
              return;
            }
            const declared = Number(response.headers["content-length"]);
            if (Number.isFinite(declared) && declared > bound) {
              child.destroy(new Error("RESPONSE_BOUND_EXCEEDED"));
              return;
            }
            response.on("data", (chunk: Uint8Array) => {
              size += chunk.byteLength;
              if (size > bound) {
                child.destroy(new Error("RESPONSE_BOUND_EXCEEDED"));
                return;
              }
              chunks.push(chunk);
            });
            response.on("error", reject);
            response.on("end", () => {
              resolve(Buffer.concat(chunks));
            });
          },
        );
        const timer = setTimeout(() => {
          child.destroy(new Error("KUBERNETES_READ_TIMEOUT"));
        }, 5000);
        child.on("close", () => {
          clearTimeout(timer);
        });
        child.on("error", reject);
        child.end();
      });
      if (bytes === null) throw new Error("NOT_FOUND");
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      return parsed;
    } catch (error) {
      reportFailedRead(path, error);
      throw new FlagsIngressIdentityError(
        "private ingress identity verification unavailable",
      );
    }
  };
}

async function listPods(
  read: FlagsKubernetesReader,
): Promise<Record<string, unknown>[]> {
  const path = `/api/v1/namespaces/${FLAGS_TAILSCALE_INGRESS.proxyNamespace}/pods`;
  const items: Record<string, unknown>[] = [];
  let token: string | undefined;
  do {
    const query = new URLSearchParams({ limit: String(PROXY_POD_PAGE) });
    if (token !== undefined) query.set("continue", token);
    const page = PageSchema.parse(await read(`${path}?${query.toString()}`));
    items.push(...page.items);
    if (items.length > MAX_PROXY_PODS) {
      throw new FlagsIngressIdentityError(
        "private ingress identity verification unavailable",
      );
    }
    const next = page.metadata?.continue;
    token = next === undefined || next === "" ? undefined : next;
  } while (token !== undefined);
  return items;
}

const parentMatches = (labels: Record<string, string>) =>
  Object.entries(FLAGS_TAILSCALE_INGRESS.parentLabels).every(
    ([key, value]) => labels[key] === value,
  );

const requireIdentity = (condition: boolean) => {
  if (!condition) {
    throw new FlagsIngressIdentityError(
      "private ingress identity could not be verified",
    );
  }
};

const live = (metadata: z.infer<typeof Metadata>) =>
  metadata.deletionTimestamp === undefined ||
  metadata.deletionTimestamp === null;

const sortedLabels = (labels: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)),
  );

function verifyController(input: {
  controller: z.infer<typeof StatefulSetSchema>;
  owner: { name: string; uid: string };
  pod: z.infer<typeof PodSchema>;
  ingressUid: string;
}): void {
  const { controller, owner, pod, ingressUid } = input;
  requireIdentity(
    controller.metadata.name === owner.name &&
      controller.metadata.namespace ===
        FLAGS_TAILSCALE_INGRESS.proxyNamespace &&
      controller.metadata.uid === owner.uid &&
      live(controller.metadata) &&
      parentMatches(controller.metadata.labels) &&
      controller.spec.selector.matchLabels["app"] === ingressUid &&
      controller.spec.template.metadata.labels["app"] === ingressUid &&
      parentMatches(controller.spec.template.metadata.labels) &&
      Object.entries(controller.spec.selector.matchLabels).every(
        ([key, value]) => pod.metadata.labels[key] === value,
      ),
  );
}

async function observe(read: FlagsKubernetesReader) {
  const [rawIngress, rawPods] = await Promise.all([
    read(
      `/apis/networking.k8s.io/v1/namespaces/${FLAGS_TAILSCALE_INGRESS.namespace}/ingresses/${FLAGS_TAILSCALE_INGRESS.name}`,
    ),
    listPods(read),
  ]);
  const ingress = IngressSchema.parse(rawIngress);
  const pods = PodsSchema.parse(rawPods);
  requireIdentity(
    ingress.metadata.name === FLAGS_TAILSCALE_INGRESS.name &&
      ingress.metadata.namespace === FLAGS_TAILSCALE_INGRESS.namespace &&
      live(ingress.metadata) &&
      ingress.metadata.annotations["tailscale.com/funnel"] !== "true",
  );
  const allAddresses = new Set<string>();
  for (const pod of pods) {
    requireIdentity(
      pod.metadata.namespace === FLAGS_TAILSCALE_INGRESS.proxyNamespace,
    );
    const addresses = new Set(
      [
        pod.status.podIP,
        ...(pod.status.podIPs ?? []).map((value) => value.ip),
      ].flatMap((value) => (value === undefined ? [] : [value])),
    );
    for (const address of addresses) {
      requireIdentity(isIP(address) !== 0 && !allAddresses.has(address));
      allAddresses.add(address);
    }
  }
  const ready = pods.filter(
    (pod) =>
      parentMatches(pod.metadata.labels) &&
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
    if (owner === undefined) throw new Error("Missing checked StatefulSet");
    const controller = StatefulSetSchema.parse(
      await read(
        `/apis/apps/v1/namespaces/${FLAGS_TAILSCALE_INGRESS.proxyNamespace}/statefulsets/${encodeURIComponent(owner.name)}`,
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
    if (address === undefined) throw new Error("Missing checked podIP");
    owners.add(owner.uid);
    identities.push({
      podUid: pod.metadata.uid,
      address,
      controllerUid: controller.metadata.uid,
      selector: sortedLabels(controller.spec.selector.matchLabels),
    });
  }
  requireIdentity(owners.size === 1);
  identities.sort((left, right) => left.podUid.localeCompare(right.podUid));
  return {
    ingressUid: ingress.metadata.uid,
    tags: ingress.metadata.annotations["tailscale.com/tags"] ?? "",
    identities,
  };
}

/** Fence the current Ingress UID, owner chain, and ready proxy Pod IP twice for each human request. */
export function createFlagsTrustedProxyAddresses(
  read: FlagsKubernetesReader = createProjectedFlagsKubernetesReader(),
): () => Promise<readonly string[]> {
  return async () => {
    try {
      const before = await observe(read);
      const after = await observe(read);
      requireIdentity(JSON.stringify(before) === JSON.stringify(after));
      return after.identities.map((identity) => identity.address);
    } catch (error) {
      if (error instanceof FlagsIngressIdentityError) throw error;
      throw new FlagsIngressIdentityError(
        "private ingress identity verification unavailable",
      );
    }
  };
}
