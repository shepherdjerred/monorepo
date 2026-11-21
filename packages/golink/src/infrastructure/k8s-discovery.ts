import { z } from "zod";

const SERVICE_ACCOUNT_TOKEN_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";
const SERVICE_ACCOUNT_CA_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const DEFAULT_POLL_INTERVAL_MS = 30_000;

const K8sLoadBalancerStatusSchema = z
  .object({
    loadBalancer: z
      .object({
        ingress: z
          .array(
            z.object({
              hostname: z.string().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .optional();

const K8sIngressListSchema = z.object({
  items: z.array(
    z.object({
      spec: z
        .object({
          ingressClassName: z.string().optional(),
          tls: z
            .array(
              z.object({
                hosts: z.array(z.string()).optional(),
              }),
            )
            .optional(),
        })
        .optional(),
      status: K8sLoadBalancerStatusSchema,
    }),
  ),
});

const K8sServiceListSchema = z.object({
  items: z.array(
    z.object({
      metadata: z
        .object({
          annotations: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
      spec: z
        .object({
          loadBalancerClass: z.string().optional(),
        })
        .optional(),
      status: K8sLoadBalancerStatusSchema,
    }),
  ),
});

function collectHostsFromIngress(
  item: z.infer<typeof K8sIngressListSchema>["items"][number],
  hosts: Set<string>,
): void {
  if (item.spec?.ingressClassName !== "tailscale") {
    return;
  }
  const lbHostname = item.status?.loadBalancer?.ingress?.[0]?.hostname?.trim();
  if (lbHostname !== undefined && lbHostname !== "") {
    hosts.add(lbHostname.toLowerCase());
    return;
  }
  for (const tlsEntry of item.spec.tls ?? []) {
    for (const tlsHost of tlsEntry.hosts ?? []) {
      const trimmed = tlsHost.trim().toLowerCase();
      if (trimmed !== "") {
        hosts.add(trimmed);
      }
    }
  }
}

function collectHostFromService(
  service: z.infer<typeof K8sServiceListSchema>["items"][number],
  hosts: Set<string>,
): void {
  if (service.spec?.loadBalancerClass !== "tailscale") {
    return;
  }
  const annotatedHost =
    service.metadata?.annotations?.["tailscale.com/hostname"]?.trim();
  const lbHostname =
    service.status?.loadBalancer?.ingress?.[0]?.hostname?.trim();
  const candidate =
    annotatedHost !== undefined && annotatedHost !== ""
      ? annotatedHost
      : lbHostname;
  if (candidate !== undefined && candidate !== "") {
    hosts.add(candidate.toLowerCase());
  }
}

export function extractTailscaleHostsFromK8sResources(
  ingressesRaw: unknown,
  servicesRaw: unknown,
): string[] {
  const hosts = new Set<string>();
  const parsedIngresses = K8sIngressListSchema.parse(ingressesRaw);
  for (const item of parsedIngresses.items) {
    collectHostsFromIngress(item, hosts);
  }

  const parsedServices = K8sServiceListSchema.parse(servicesRaw);
  for (const service of parsedServices.items) {
    collectHostFromService(service, hosts);
  }

  return [...hosts].sort((left, right) => left.localeCompare(right));
}

export type K8sTailscaleDiscovery = {
  readonly getHosts: () => readonly string[];
  readonly refresh: () => Promise<readonly string[]>;
  readonly stop: () => void;
};

async function fetchK8sJson(
  url: string,
  token: string,
  caCert: string,
): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    tls: { ca: caCert },
  });
  if (!response.ok) {
    throw new Error(
      `Kubernetes API ${url} returned HTTP ${String(response.status)}`,
    );
  }
  return response.json();
}

export async function startK8sTailscaleDiscovery(options?: {
  readonly pollIntervalMs?: number;
  readonly tokenPath?: string;
  readonly caPath?: string;
  readonly serviceHost?: string;
  readonly servicePort?: string;
}): Promise<K8sTailscaleDiscovery> {
  const tokenPath = options?.tokenPath ?? SERVICE_ACCOUNT_TOKEN_PATH;
  const caPath = options?.caPath ?? SERVICE_ACCOUNT_CA_PATH;
  const serviceHost =
    options?.serviceHost ?? Bun.env["KUBERNETES_SERVICE_HOST"]?.trim();
  const servicePort =
    options?.servicePort ?? Bun.env["KUBERNETES_SERVICE_PORT"]?.trim() ?? "443";

  const tokenFile = Bun.file(tokenPath);
  const caFile = Bun.file(caPath);
  const hasClusterCredentials =
    serviceHost !== undefined &&
    serviceHost !== "" &&
    (await tokenFile.exists()) &&
    (await caFile.exists());

  if (!hasClusterCredentials) {
    console.warn(
      JSON.stringify({
        message: "golink_k8s_discovery_disabled",
        reason: "kubernetes_serviceaccount_unavailable",
      }),
    );
    let stopped = false;
    return {
      getHosts: () => (stopped ? [] : []),
      refresh: () => Promise.resolve([]),
      stop: () => {
        stopped = true;
      },
    };
  }

  const baseUrl = serviceHost.includes(":")
    ? `https://[${serviceHost}]:${servicePort}`
    : `https://${serviceHost}:${servicePort}`;
  let cachedHosts: readonly string[] = [];

  const refresh = async (): Promise<readonly string[]> => {
    try {
      const [tokenRaw, caCert] = await Promise.all([
        Bun.file(tokenPath).text(),
        Bun.file(caPath).text(),
      ]);
      const token = tokenRaw.trim();
      const [ingressesRaw, servicesRaw] = await Promise.all([
        fetchK8sJson(
          `${baseUrl}/apis/networking.k8s.io/v1/ingresses`,
          token,
          caCert,
        ),
        fetchK8sJson(`${baseUrl}/api/v1/services`, token, caCert),
      ]);
      cachedHosts = extractTailscaleHostsFromK8sResources(
        ingressesRaw,
        servicesRaw,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        JSON.stringify({
          message: "golink_k8s_discovery_poll_failed",
          error: message,
        }),
      );
    }
    return cachedHosts;
  };

  await refresh();
  const timer = setInterval(() => {
    void refresh();
  }, options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  timer.unref();

  return {
    getHosts: () => cachedHosts,
    refresh,
    stop: () => {
      clearInterval(timer);
    },
  };
}
