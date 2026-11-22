import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import type { PodStatus } from "@shepherdjerred/ops-clients/kubernetes.ts";
import { TailscaleClient } from "@shepherdjerred/ops-clients/tailscale.ts";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { TailscaleFacet } from "@shepherdjerred/ops-model/facets.ts";
import { tailscaleDevicesOnline } from "#observability/metrics-ops.ts";

const KEY_EXPIRY_SOON_DAYS = 14;

function countCatalogTailscaleServices(services: ServiceIndex): number {
  let count = 0;
  for (const service of services.services) {
    if (service.namespaces.length > 0 && service.kind !== "platform") {
      count += 1;
    }
  }
  return count;
}

function countClusterTailscaleProxies(
  pods: readonly PodStatus[] | undefined,
  services: ServiceIndex,
): number {
  if (pods === undefined) {
    return countCatalogTailscaleServices(services);
  }
  const proxyPods = pods.filter(
    (pod) =>
      pod.namespace === "tailscale" &&
      pod.ownerKind === "StatefulSet" &&
      pod.phase === "Running",
  );
  return proxyPods.length > 0
    ? proxyPods.length
    : countCatalogTailscaleServices(services);
}

function trimOption(
  explicit: string | undefined,
  envKey: string,
  fallback = "",
): string {
  return (explicit ?? Bun.env[envKey] ?? fallback).trim();
}

function resolveTailscaleClient(options?: {
  client?: TailscaleClient;
  apiKey?: string | undefined;
  oauthClientId?: string | undefined;
  oauthClientSecret?: string | undefined;
  tailnet?: string | undefined;
  fetchImpl?: Fetch;
}): TailscaleClient | undefined {
  if (options?.client !== undefined) {
    return options.client;
  }
  const apiKey = trimOption(options?.apiKey, "TAILSCALE_API_KEY");
  const clientId = trimOption(
    options?.oauthClientId,
    "TAILSCALE_OAUTH_CLIENT_ID",
  );
  const clientSecret = trimOption(
    options?.oauthClientSecret,
    "TAILSCALE_OAUTH_CLIENT_SECRET",
  );
  const tailnet = trimOption(options?.tailnet, "TAILSCALE_TAILNET", "-");
  const fetchOpt =
    options?.fetchImpl === undefined ? {} : { fetch: options.fetchImpl };

  if (apiKey !== "") {
    return new TailscaleClient({ apiKey, tailnet, ...fetchOpt });
  }
  return clientId !== "" && clientSecret !== ""
    ? new TailscaleClient({
        oauth: { clientId, clientSecret },
        tailnet,
        ...fetchOpt,
      })
    : undefined;
}

export async function collectTailscaleFacet(options: {
  services: ServiceIndex;
  pods?: readonly PodStatus[];
  client?: TailscaleClient;
  apiKey?: string | undefined;
  oauthClientId?: string | undefined;
  oauthClientSecret?: string | undefined;
  tailnet?: string | undefined;
  fetchImpl?: Fetch;
  now?: Date;
}): Promise<TailscaleFacet> {
  const clusterServicesCount = countClusterTailscaleProxies(
    options.pods,
    options.services,
  );
  const client = resolveTailscaleClient(options);
  if (client === undefined) {
    return {
      totalDevices: 0,
      onlineDevices: 0,
      expiringKeysSoon: 0,
      clusterServicesCount,
      devices: [],
    };
  }

  const rawDevices = await client.listDevices(options.now ?? new Date());
  const devices: TailscaleFacet["devices"] = rawDevices.map((device) => ({
    id: device.id,
    name: device.name,
    hostname: device.hostname,
    os: device.os,
    clientVersion: device.clientVersion,
    updateAvailable: device.updateAvailable,
    online: device.online,
    lastSeen: device.lastSeen,
    expiresAt: device.expires,
    daysToExpiry: device.daysToExpiry,
    tags: device.tags,
    addresses: device.addresses,
  }));

  const onlineDevices = devices.filter((device) => device.online).length;
  const expiringKeysSoon = devices.filter(
    (device) =>
      device.daysToExpiry !== null &&
      device.daysToExpiry <= KEY_EXPIRY_SOON_DAYS,
  ).length;

  tailscaleDevicesOnline.set(onlineDevices);

  return {
    totalDevices: devices.length,
    onlineDevices,
    expiringKeysSoon,
    clusterServicesCount,
    devices,
  };
}
