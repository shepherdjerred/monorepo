import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BlockList } from "node:net";
import {
  createFeedsTrustedProxyAddresses,
  createProjectedFeedsKubernetesReader,
  FeedsIngressIdentityError,
} from "./ingress-proxy.ts";
import { resolveNormalizedIp } from "./ssrf.ts";

export const DEFAULT_FEEDS_PUBLIC_ORIGIN = "https://feeds.tailnet-1a49.ts.net";

export type FeedsAuthConfig = {
  readonly machineToken: string | undefined;
  readonly operatorLogins: readonly string[];
  readonly trustedProxyAddresses:
    readonly string[] | (() => Promise<readonly string[]>);
  readonly publicOrigin: string;
};

export type FeedsMachinePrincipal = {
  readonly kind: "machine";
};

export type FeedsHumanPrincipal = {
  readonly kind: "human";
  readonly login: string;
};

export type FeedsPrincipal = FeedsMachinePrincipal | FeedsHumanPrincipal;

export type AuthFailure = {
  readonly status: 401 | 403 | 503;
  readonly error: string;
};

const DECIMAL_PREFIX_PATTERN = /^(?:0|[1-9]\d*)$/u;
const IDEMPOTENT_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const staticBlockListCache = new WeakMap<readonly string[], BlockList>();

function sha256Bytes(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

function normalizeOriginOrThrow(rawOrigin: string): string {
  try {
    return new URL(rawOrigin).origin;
  } catch {
    throw new Error("FEEDS_PUBLIC_ORIGIN is not a URL");
  }
}

function parseCommaSeparatedValues(raw: string | undefined): string[] {
  if (raw === undefined || raw.length === 0) {
    return [];
  }
  const items: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      items.push(trimmed);
    }
  }
  return items;
}

function registerTrustedProxyEntry(list: BlockList, rawEntry: string): void {
  const slashIndex = rawEntry.indexOf("/");
  if (slashIndex === -1) {
    const endpoint = resolveNormalizedIp(rawEntry);
    if (endpoint === undefined) {
      throw new Error(`Invalid FEEDS_TRUSTED_PROXIES entry: ${rawEntry}`);
    }
    list.addAddress(endpoint.address, endpoint.family);
    return;
  }

  const hostPart = rawEntry.slice(0, slashIndex);
  const prefixPart = rawEntry.slice(slashIndex + 1);
  if (
    hostPart.length === 0 ||
    prefixPart.includes("/") ||
    !DECIMAL_PREFIX_PATTERN.test(prefixPart)
  ) {
    throw new Error(`Invalid FEEDS_TRUSTED_PROXIES entry: ${rawEntry}`);
  }
  const endpoint = resolveNormalizedIp(hostPart);
  const prefixBits = Number(prefixPart);
  const maxBits = endpoint?.family === "ipv4" ? 32 : 128;
  if (
    endpoint === undefined ||
    !Number.isSafeInteger(prefixBits) ||
    prefixBits < 0 ||
    prefixBits > maxBits
  ) {
    throw new Error(`Invalid FEEDS_TRUSTED_PROXIES entry: ${rawEntry}`);
  }
  list.addSubnet(endpoint.address, prefixBits, endpoint.family);
}

/**
 * Builds a `BlockList` matching exact proxy IP addresses and CIDR subnets,
 * failing fast on any malformed entry so invalid `FEEDS_TRUSTED_PROXIES`
 * configuration never silently fails open or closed.
 */
export function parseTrustedProxyBlockList(
  entries: readonly string[],
): BlockList {
  const list = new BlockList();
  for (const entry of entries) {
    registerTrustedProxyEntry(list, entry);
  }
  return list;
}

async function loadTrustedProxies(
  source: FeedsAuthConfig["trustedProxyAddresses"],
): Promise<BlockList | AuthFailure> {
  if (typeof source !== "function") {
    const cached = staticBlockListCache.get(source);
    if (cached !== undefined) {
      return cached;
    }
    const built = parseTrustedProxyBlockList(source);
    staticBlockListCache.set(source, built);
    return built;
  }
  try {
    const dynamicAddresses = await source();
    return parseTrustedProxyBlockList(dynamicAddresses);
  } catch (error) {
    return {
      status: 503,
      error:
        error instanceof FeedsIngressIdentityError
          ? error.message
          : "private ingress identity verification unavailable",
    };
  }
}

function extractBearerToken(authHeader: string | null): string | undefined {
  if (authHeader?.startsWith("Bearer ") !== true) {
    return undefined;
  }
  const candidate = authHeader.slice("Bearer ".length);
  return candidate.length > 0 ? candidate : undefined;
}

/**
 * Strictly authenticates machine callers (such as Temporal `/internal/refresh`)
 * via `Authorization: Bearer <FEEDS_MACHINE_TOKEN>`.
 */
export function authenticateMachine(
  request: Request,
  config: FeedsAuthConfig,
): FeedsMachinePrincipal | AuthFailure {
  const presentedToken = extractBearerToken(
    request.headers.get("authorization"),
  );
  const configuredToken = config.machineToken;
  const hasConfiguredToken =
    configuredToken !== undefined && configuredToken.length > 0;
  const comparisonTarget = hasConfiguredToken
    ? configuredToken
    : randomBytes(32).toString("hex");
  const matches =
    presentedToken !== undefined &&
    hasConfiguredToken &&
    timingSafeEqual(sha256Bytes(presentedToken), sha256Bytes(comparisonTarget));
  return matches
    ? { kind: "machine" }
    : { status: 401, error: "invalid machine credential" };
}

/**
 * Authenticates human console requests by verifying the trusted Tailscale
 * ingress proxy peer IP, `Tailscale-User-Login` allowlist membership, and
 * same-origin `Origin` on state-changing HTTP methods.
 */
export async function authenticateConsole(
  request: Request,
  peerAddress: string | null,
  config: FeedsAuthConfig,
): Promise<FeedsHumanPrincipal | AuthFailure> {
  const peerEndpoint =
    peerAddress === null ? undefined : resolveNormalizedIp(peerAddress);
  if (peerEndpoint === undefined) {
    return { status: 401, error: "authenticated private ingress required" };
  }

  const proxyAllowlist = await loadTrustedProxies(config.trustedProxyAddresses);
  if ("status" in proxyAllowlist) {
    return proxyAllowlist;
  }
  if (!proxyAllowlist.check(peerEndpoint.address, peerEndpoint.family)) {
    return { status: 401, error: "authenticated private ingress required" };
  }

  const tailscaleLogin = request.headers.get("tailscale-user-login");
  if (
    tailscaleLogin === null ||
    !config.operatorLogins.includes(tailscaleLogin)
  ) {
    return { status: 403, error: "operator identity is not authorized" };
  }

  if (!IDEMPOTENT_HTTP_METHODS.has(request.method.toUpperCase())) {
    const expectedOrigin = normalizeOriginOrThrow(config.publicOrigin);
    if (request.headers.get("origin") !== expectedOrigin) {
      return { status: 403, error: "same-origin browser request required" };
    }
  }

  return { kind: "human", login: tailscaleLogin };
}

export function authFromEnv(env: NodeJS.ProcessEnv = Bun.env): FeedsAuthConfig {
  const configuredOrigin = env["FEEDS_PUBLIC_ORIGIN"]?.trim();
  const publicOrigin =
    configuredOrigin !== undefined && configuredOrigin.length > 0
      ? configuredOrigin
      : DEFAULT_FEEDS_PUBLIC_ORIGIN;
  normalizeOriginOrThrow(publicOrigin);

  const configuredProxies = parseCommaSeparatedValues(
    env["FEEDS_TRUSTED_PROXIES"],
  );
  const projectedIdentityDir = env["FEEDS_INGRESS_IDENTITY_DIR"]?.trim();
  const usesProjectedIdentity =
    projectedIdentityDir !== undefined && projectedIdentityDir.length > 0;
  if (usesProjectedIdentity && configuredProxies.length > 0) {
    throw new Error(
      "Set either FEEDS_TRUSTED_PROXIES or FEEDS_INGRESS_IDENTITY_DIR, not both",
    );
  }

  const trustedProxyAddresses: FeedsAuthConfig["trustedProxyAddresses"] =
    usesProjectedIdentity
      ? createFeedsTrustedProxyAddresses(
          createProjectedFeedsKubernetesReader(projectedIdentityDir),
        )
      : (() => {
          staticBlockListCache.set(
            configuredProxies,
            parseTrustedProxyBlockList(configuredProxies),
          );
          return configuredProxies;
        })();

  const rawMachineToken = env["FEEDS_MACHINE_TOKEN"];
  return {
    machineToken:
      rawMachineToken !== undefined && rawMachineToken.length > 0
        ? rawMachineToken
        : undefined,
    operatorLogins: parseCommaSeparatedValues(env["FEEDS_OPERATOR_LOGINS"]),
    trustedProxyAddresses,
    publicOrigin,
  };
}
