import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";
import {
  createFeedsTrustedProxyAddresses,
  createProjectedFeedsKubernetesReader,
  FeedsIngressIdentityError,
} from "./ingress-proxy.ts";

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

const NON_NEGATIVE_INTEGER = /^(?:0|[1-9]\d*)$/u;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const digest = (value: string) => createHash("sha256").update(value).digest();
const cachedBlockLists = new WeakMap<readonly string[], BlockList>();

function canonicalPeer(address: string): string {
  return address.startsWith("::ffff:") &&
    isIP(address) === 6 &&
    isIP(address.slice(7)) === 4
    ? address.slice(7)
    : address;
}

function ipType(version: number): "ipv4" | "ipv6" | undefined {
  if (version === 4) return "ipv4";
  return version === 6 ? "ipv6" : undefined;
}

function parsePublicOrigin(rawOrigin: string): string {
  try {
    return new URL(rawOrigin).origin;
  } catch {
    throw new Error("FEEDS_PUBLIC_ORIGIN is not a URL");
  }
}

/**
 * Builds a `BlockList` matching exact proxy IP addresses and CIDR subnets,
 * failing fast on any malformed entry so invalid `FEEDS_TRUSTED_PROXIES`
 * configuration never silently fails open or closed.
 */
export function parseTrustedProxyBlockList(
  entries: readonly string[],
): BlockList {
  const blockList = new BlockList();
  for (const rawEntry of entries) {
    if (rawEntry.includes("/")) {
      const parts = rawEntry.split("/");
      const rawNetwork = parts[0];
      const rawPrefix = parts[1];
      if (
        rawNetwork === undefined ||
        rawPrefix === undefined ||
        parts.length !== 2 ||
        !NON_NEGATIVE_INTEGER.test(rawPrefix)
      ) {
        throw new Error(`Invalid FEEDS_TRUSTED_PROXIES entry: ${rawEntry}`);
      }
      const network = canonicalPeer(rawNetwork);
      const family = ipType(isIP(network));
      const prefix = Number(rawPrefix);
      const maxPrefix = family === "ipv4" ? 32 : 128;
      if (
        family === undefined ||
        prefix < 0 ||
        prefix > maxPrefix ||
        !Number.isSafeInteger(prefix)
      ) {
        throw new Error(`Invalid FEEDS_TRUSTED_PROXIES entry: ${rawEntry}`);
      }
      blockList.addSubnet(network, prefix, family);
      continue;
    }
    const address = canonicalPeer(rawEntry);
    const family = ipType(isIP(address));
    if (family === undefined) {
      throw new Error(`Invalid FEEDS_TRUSTED_PROXIES entry: ${rawEntry}`);
    }
    blockList.addAddress(address, family);
  }
  return blockList;
}

function trustedProxyBlockList(entries: readonly string[]): BlockList {
  const existing = cachedBlockLists.get(entries);
  if (existing !== undefined) return existing;
  const parsed = parseTrustedProxyBlockList(entries);
  cachedBlockLists.set(entries, parsed);
  return parsed;
}

async function resolveTrustedProxyBlockList(
  trustedProxyAddresses: FeedsAuthConfig["trustedProxyAddresses"],
): Promise<BlockList | AuthFailure> {
  if (typeof trustedProxyAddresses !== "function") {
    return trustedProxyBlockList(trustedProxyAddresses);
  }
  try {
    return parseTrustedProxyBlockList(await trustedProxyAddresses());
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

function bearer(header: string | null): string | undefined {
  if (header === null) return undefined;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return undefined;
  const token = header.slice(prefix.length);
  return token.length > 0 ? token : undefined;
}

/**
 * Strictly authenticates machine callers (such as Temporal `/internal/refresh`)
 * via `Authorization: Bearer <FEEDS_MACHINE_TOKEN>`.
 */
export function authenticateMachine(
  request: Request,
  config: FeedsAuthConfig,
): FeedsMachinePrincipal | AuthFailure {
  const presented = bearer(request.headers.get("authorization"));
  const expected =
    config.machineToken !== undefined && config.machineToken.length > 0
      ? config.machineToken
      : randomBytes(32).toString("hex");
  const valid =
    presented !== undefined &&
    config.machineToken !== undefined &&
    config.machineToken.length > 0 &&
    timingSafeEqual(digest(presented), digest(expected));
  return valid
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
  if (peerAddress === null) {
    return { status: 401, error: "authenticated private ingress required" };
  }
  const peer = canonicalPeer(peerAddress);
  const family = ipType(isIP(peer));
  if (family === undefined) {
    return { status: 401, error: "authenticated private ingress required" };
  }
  const resolved = await resolveTrustedProxyBlockList(
    config.trustedProxyAddresses,
  );
  if ("status" in resolved) return resolved;
  if (!resolved.check(peer, family)) {
    return { status: 401, error: "authenticated private ingress required" };
  }
  const login = request.headers.get("tailscale-user-login");
  if (login === null || !config.operatorLogins.includes(login)) {
    return { status: 403, error: "operator identity is not authorized" };
  }
  if (!SAFE_METHODS.has(request.method.toUpperCase())) {
    const origin = request.headers.get("origin");
    const expected = parsePublicOrigin(config.publicOrigin);
    if (origin !== expected) {
      return { status: 403, error: "same-origin browser request required" };
    }
  }
  return { kind: "human", login };
}

export function authFromEnv(env: NodeJS.ProcessEnv = Bun.env): FeedsAuthConfig {
  const token = env["FEEDS_MACHINE_TOKEN"];
  const rawOrigin = env["FEEDS_PUBLIC_ORIGIN"]?.trim();
  const origin =
    rawOrigin === undefined || rawOrigin.length === 0
      ? DEFAULT_FEEDS_PUBLIC_ORIGIN
      : rawOrigin;
  parsePublicOrigin(origin);

  const staticProxies = splitList(env["FEEDS_TRUSTED_PROXIES"]);
  const identityDir = env["FEEDS_INGRESS_IDENTITY_DIR"]?.trim();
  const hasIdentityDir = identityDir !== undefined && identityDir.length > 0;
  if (hasIdentityDir && staticProxies.length > 0) {
    throw new Error(
      "Set either FEEDS_TRUSTED_PROXIES or FEEDS_INGRESS_IDENTITY_DIR, not both",
    );
  }
  let trustedProxyAddresses: FeedsAuthConfig["trustedProxyAddresses"];
  if (hasIdentityDir) {
    trustedProxyAddresses = createFeedsTrustedProxyAddresses(
      createProjectedFeedsKubernetesReader(identityDir),
    );
  } else {
    cachedBlockLists.set(
      staticProxies,
      parseTrustedProxyBlockList(staticProxies),
    );
    trustedProxyAddresses = staticProxies;
  }
  return {
    machineToken: token === undefined || token.length === 0 ? undefined : token,
    operatorLogins: splitList(env["FEEDS_OPERATOR_LOGINS"]),
    trustedProxyAddresses,
    publicOrigin: origin,
  };
}

function splitList(value: string | undefined): string[] {
  return value === undefined || value.length === 0
    ? []
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}
