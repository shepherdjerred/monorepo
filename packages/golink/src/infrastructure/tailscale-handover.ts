import { z } from "zod";

const DEFAULT_TOKEN_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";
const DEFAULT_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const DEFAULT_NAMESPACE_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/namespace";
const DEFAULT_TAILSCALE_API_BASE_URL = "https://api.tailscale.com";
const ALLOWED_CLUSTER_TAGS = new Set(["tag:k8s", "tag:k8s-operator"]);

export const TailscaleHandoverBootstrapSchema = z.object({
  TS_OAUTH_CLIENT_ID: z.string().min(1),
  TS_OAUTH_CLIENT_SECRET: z.string().min(1),
  TS_STATE_SECRET_NAME: z.string().min(1).default("golink-tailscale-state"),
  TS_EXPECTED_HOSTNAME: z.string().min(1).default("go"),
  TS_EXPECTED_FQDN: z.string().min(1).default("go.tailnet-1a49.ts.net"),
  TAILSCALE_API_BASE_URL: z.url().default(DEFAULT_TAILSCALE_API_BASE_URL),
});
export type TailscaleHandoverBootstrap = z.infer<
  typeof TailscaleHandoverBootstrapSchema
>;

const K8sSecretSchema = z.object({
  metadata: z
    .object({
      name: z.string().optional(),
      namespace: z.string().optional(),
      resourceVersion: z.string().optional(),
    })
    .optional(),
  data: z.record(z.string(), z.string()).optional(),
});

const OAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

const TailscaleDeviceSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().optional(),
  hostname: z.string(),
  name: z.string(),
  tags: z.array(z.string()).optional(),
});
export type TailscaleDevice = z.infer<typeof TailscaleDeviceSchema>;

const TailscaleDevicesResponseSchema = z.object({
  devices: z.array(TailscaleDeviceSchema),
});

export type HandoverFetch = (
  url: string,
  init?: RequestInit & { tls?: { ca: string } },
) => Promise<Response>;

export type TailscaleHandoverOptions = {
  readonly config: TailscaleHandoverBootstrap;
  readonly k8sBaseUrl: string;
  readonly k8sNamespace: string;
  readonly k8sToken: string;
  readonly k8sCaCert: string;
  readonly fetchImpl?: HandoverFetch;
  readonly sleepMs?: (ms: number) => Promise<void>;
};

export type TailscaleHandoverResult =
  | {
      readonly action: "reused-persisted-state";
      readonly fqdn: string;
    }
  | {
      readonly action: "prepared-fresh-registration";
      readonly deletedDeviceIds: readonly string[];
      readonly resetStateSecret: boolean;
    };

function normalizeDnsName(name: string): string {
  return name.trim().replace(/\.$/u, "").toLowerCase();
}

function decodeSecretField(
  data: Record<string, string> | undefined,
  key: string,
): string | undefined {
  const encoded = data?.[key];
  if (encoded === undefined || encoded === "") {
    return undefined;
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
  return decoded === "" ? undefined : decoded;
}

function matchesTargetIdentity(
  device: TailscaleDevice,
  expectedHostname: string,
  expectedFqdn: string,
  persistedDeviceId: string | undefined,
): boolean {
  const normalizedFqdn = normalizeDnsName(device.name);
  const firstLabel = normalizedFqdn.split(".")[0];
  if (
    normalizedFqdn === expectedFqdn ||
    firstLabel === expectedHostname ||
    device.hostname.trim().toLowerCase() === expectedHostname
  ) {
    return true;
  }
  if (
    persistedDeviceId !== undefined &&
    (device.nodeId === persistedDeviceId || device.id === persistedDeviceId)
  ) {
    return true;
  }
  return false;
}

function assertClusterOwnedDevice(device: TailscaleDevice): void {
  const tags = device.tags ?? [];
  const ownedByCluster = tags.some((tag) => ALLOWED_CLUSTER_TAGS.has(tag));
  if (!ownedByCluster) {
    throw new Error(
      `Refusing to delete Tailscale device ${device.id} (${device.name}) because its tags [${tags.join(", ")}] are not cluster-owned`,
    );
  }
}

async function readStateSecret(options: {
  readonly fetchImpl: HandoverFetch;
  readonly k8sBaseUrl: string;
  readonly k8sNamespace: string;
  readonly secretName: string;
  readonly k8sToken: string;
  readonly k8sCaCert: string;
}): Promise<z.infer<typeof K8sSecretSchema> | null> {
  const url = `${options.k8sBaseUrl}/api/v1/namespaces/${encodeURIComponent(options.k8sNamespace)}/secrets/${encodeURIComponent(options.secretName)}`;
  const response = await options.fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${options.k8sToken}`,
      Accept: "application/json",
    },
    tls: { ca: options.k8sCaCert },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Kubernetes Secret GET ${options.secretName} failed with HTTP ${String(response.status)}`,
    );
  }
  return K8sSecretSchema.parse(await response.json());
}

async function clearStateSecretData(options: {
  readonly fetchImpl: HandoverFetch;
  readonly k8sBaseUrl: string;
  readonly k8sNamespace: string;
  readonly secretName: string;
  readonly resourceVersion: string | undefined;
  readonly k8sToken: string;
  readonly k8sCaCert: string;
}): Promise<void> {
  const url = `${options.k8sBaseUrl}/api/v1/namespaces/${encodeURIComponent(options.k8sNamespace)}/secrets/${encodeURIComponent(options.secretName)}`;
  const response = await options.fetchImpl(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${options.k8sToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: options.secretName,
        namespace: options.k8sNamespace,
        ...(options.resourceVersion === undefined
          ? {}
          : { resourceVersion: options.resourceVersion }),
      },
      type: "Opaque",
      data: {},
    }),
    tls: { ca: options.k8sCaCert },
  });
  if (!response.ok) {
    throw new Error(
      `Kubernetes Secret PUT ${options.secretName} failed with HTTP ${String(response.status)}`,
    );
  }
}

async function fetchTailscaleAccessToken(
  fetchImpl: HandoverFetch,
  apiBaseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const response = await fetchImpl(`${apiBaseUrl}/api/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Tailscale OAuth token exchange failed with HTTP ${String(response.status)}`,
    );
  }
  const parsed = OAuthTokenResponseSchema.parse(await response.json());
  return parsed.access_token;
}

async function listTailnetDevices(
  fetchImpl: HandoverFetch,
  apiBaseUrl: string,
  accessToken: string,
): Promise<readonly TailscaleDevice[]> {
  const response = await fetchImpl(`${apiBaseUrl}/api/v2/tailnet/-/devices`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Tailscale list devices failed with HTTP ${String(response.status)}`,
    );
  }
  return TailscaleDevicesResponseSchema.parse(await response.json()).devices;
}

async function deleteTailnetDevice(
  fetchImpl: HandoverFetch,
  apiBaseUrl: string,
  accessToken: string,
  deviceId: string,
): Promise<void> {
  const response = await fetchImpl(
    `${apiBaseUrl}/api/v2/device/${encodeURIComponent(deviceId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Tailscale delete device ${deviceId} failed with HTTP ${String(response.status)}`,
    );
  }
}

async function verifyHostnameReleased(options: {
  readonly fetchImpl: HandoverFetch;
  readonly apiBaseUrl: string;
  readonly accessToken: string;
  readonly expectedHostname: string;
  readonly expectedFqdn: string;
  readonly sleepMs: (ms: number) => Promise<void>;
}): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const devices = await listTailnetDevices(
      options.fetchImpl,
      options.apiBaseUrl,
      options.accessToken,
    );
    const remaining = devices.filter((device) =>
      matchesTargetIdentity(
        device,
        options.expectedHostname,
        options.expectedFqdn,
        undefined,
      ),
    );
    if (remaining.length === 0) {
      return;
    }
    if (attempt === 5) {
      throw new Error(
        `Tailscale hostname ${options.expectedFqdn} is still claimed by [${remaining.map((device) => `${device.id}:${device.name}`).join(", ")}]`,
      );
    }
    await options.sleepMs(1000);
  }
}

export async function reconcileTailscaleHostnameHandover(
  options: TailscaleHandoverOptions,
): Promise<TailscaleHandoverResult> {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleepMs =
    options.sleepMs ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const expectedHostname =
    options.config.TS_EXPECTED_HOSTNAME.trim().toLowerCase();
  const expectedFqdn = normalizeDnsName(options.config.TS_EXPECTED_FQDN);
  const apiBaseUrl = options.config.TAILSCALE_API_BASE_URL.replace(/\/$/u, "");

  const secret = await readStateSecret({
    fetchImpl,
    k8sBaseUrl: options.k8sBaseUrl,
    k8sNamespace: options.k8sNamespace,
    secretName: options.config.TS_STATE_SECRET_NAME,
    k8sToken: options.k8sToken,
    k8sCaCert: options.k8sCaCert,
  });

  const data = secret?.data;
  const hasPersistedState =
    data !== undefined &&
    ("_current-profile" in data || "tailscaled.state" in data);
  const persistedFqdnRaw = decodeSecretField(data, "device_fqdn");
  const persistedFqdn =
    persistedFqdnRaw === undefined
      ? undefined
      : normalizeDnsName(persistedFqdnRaw);
  const persistedDeviceId = decodeSecretField(data, "device_id");

  if (hasPersistedState && persistedFqdn === expectedFqdn) {
    return { action: "reused-persisted-state", fqdn: persistedFqdn };
  }

  let resetStateSecret = false;
  if (secret !== null && Object.keys(data ?? {}).length > 0) {
    await clearStateSecretData({
      fetchImpl,
      k8sBaseUrl: options.k8sBaseUrl,
      k8sNamespace: options.k8sNamespace,
      secretName: options.config.TS_STATE_SECRET_NAME,
      resourceVersion: secret.metadata?.resourceVersion,
      k8sToken: options.k8sToken,
      k8sCaCert: options.k8sCaCert,
    });
    resetStateSecret = true;
  }

  const accessToken = await fetchTailscaleAccessToken(
    fetchImpl,
    apiBaseUrl,
    options.config.TS_OAUTH_CLIENT_ID,
    options.config.TS_OAUTH_CLIENT_SECRET,
  );
  const devices = await listTailnetDevices(fetchImpl, apiBaseUrl, accessToken);
  const conflicting = devices.filter((device) =>
    matchesTargetIdentity(
      device,
      expectedHostname,
      expectedFqdn,
      persistedDeviceId,
    ),
  );

  for (const device of conflicting) {
    assertClusterOwnedDevice(device);
  }
  const deletedDeviceIds: string[] = [];
  for (const device of conflicting) {
    await deleteTailnetDevice(fetchImpl, apiBaseUrl, accessToken, device.id);
    deletedDeviceIds.push(device.id);
  }

  await verifyHostnameReleased({
    fetchImpl,
    apiBaseUrl,
    accessToken,
    expectedHostname,
    expectedFqdn,
    sleepMs,
  });

  return {
    action: "prepared-fresh-registration",
    deletedDeviceIds,
    resetStateSecret,
  };
}

export async function resolveInClusterCoordinates(paths?: {
  readonly tokenPath?: string;
  readonly caPath?: string;
  readonly namespacePath?: string;
  readonly serviceHost?: string;
  readonly servicePort?: string;
}): Promise<{
  readonly k8sBaseUrl: string;
  readonly k8sNamespace: string;
  readonly k8sToken: string;
  readonly k8sCaCert: string;
}> {
  const tokenPath = paths?.tokenPath ?? DEFAULT_TOKEN_PATH;
  const caPath = paths?.caPath ?? DEFAULT_CA_PATH;
  const namespacePath = paths?.namespacePath ?? DEFAULT_NAMESPACE_PATH;
  const serviceHost =
    paths?.serviceHost ?? Bun.env["KUBERNETES_SERVICE_HOST"]?.trim();
  const servicePort =
    paths?.servicePort ?? Bun.env["KUBERNETES_SERVICE_PORT"]?.trim() ?? "443";

  if (serviceHost === undefined || serviceHost === "") {
    throw new Error(
      "KUBERNETES_SERVICE_HOST is required for Tailscale hostname handover",
    );
  }

  const [tokenRaw, caCert, namespaceRaw] = await Promise.all([
    Bun.file(tokenPath).text(),
    Bun.file(caPath).text(),
    Bun.file(namespacePath)
      .text()
      .catch(() => "golink"),
  ]);

  const k8sBaseUrl = serviceHost.includes(":")
    ? `https://[${serviceHost}]:${servicePort}`
    : `https://${serviceHost}:${servicePort}`;
  return {
    k8sBaseUrl,
    k8sNamespace: namespaceRaw.trim() || "golink",
    k8sToken: tokenRaw.trim(),
    k8sCaCert: caCert,
  };
}
