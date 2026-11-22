import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";
import {
  createFlagsTrustedProxyAddresses,
  createProjectedFlagsKubernetesReader,
  FlagsIngressIdentityError,
} from "./ingress-proxy.ts";

export type FlagsAuthConfig = {
  readonly machineToken: string | undefined;
  readonly operatorLogins: readonly string[];
  readonly trustedProxyAddresses:
    readonly string[] | (() => Promise<readonly string[]>);
  readonly publicOrigin: string;
};

export type FlagsPrincipal =
  | { readonly kind: "machine" }
  | { readonly kind: "human"; readonly login: string };

export type AuthFailure = {
  readonly status: 401 | 403 | 503;
  readonly error: string;
};

const NON_NEGATIVE_INTEGER = /^(?:0|[1-9]\d*)$/u;
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

/**
 * Builds a `BlockList` matching exact proxy IP addresses and CIDR subnets,
 * failing fast on any malformed entry so invalid `FLAGS_TRUSTED_PROXIES`
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
        throw new Error(`Invalid FLAGS_TRUSTED_PROXIES entry: ${rawEntry}`);
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
        throw new Error(`Invalid FLAGS_TRUSTED_PROXIES entry: ${rawEntry}`);
      }
      blockList.addSubnet(network, prefix, family);
      continue;
    }
    const address = canonicalPeer(rawEntry);
    const family = ipType(isIP(address));
    if (family === undefined) {
      throw new Error(`Invalid FLAGS_TRUSTED_PROXIES entry: ${rawEntry}`);
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
  trustedProxyAddresses: FlagsAuthConfig["trustedProxyAddresses"],
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
        error instanceof FlagsIngressIdentityError
          ? error.message
          : "private ingress identity verification unavailable",
    };
  }
}

function bearer(header: string | undefined): string | undefined {
  const prefix = "Bearer ";
  return header?.startsWith(prefix) === true
    ? header.slice(prefix.length)
    : undefined;
}

/**
 * Machine callers present the brokered token. Humans are the tailnet login
 * the trusted proxy inserts; a browser-supplied login header is ignored.
 */
export async function authenticate(
  request: Request,
  peerAddress: string | null,
  config: FlagsAuthConfig,
): Promise<FlagsPrincipal | AuthFailure> {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const presented = bearer(authorization);
    const expected = config.machineToken ?? randomBytes(32).toString("hex");
    return presented === undefined ||
      config.machineToken === undefined ||
      !timingSafeEqual(digest(presented), digest(expected))
      ? { status: 401, error: "invalid machine credential" }
      : { kind: "machine" };
  }
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
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    let expected: string;
    try {
      expected = new URL(config.publicOrigin).origin;
    } catch {
      throw new Error("FLAGS_PUBLIC_ORIGIN is not a URL");
    }
    if (origin !== expected) {
      return { status: 403, error: "same-origin browser request required" };
    }
  }
  return { kind: "human", login };
}

export function authFromEnv(env: NodeJS.ProcessEnv = Bun.env): FlagsAuthConfig {
  const token = env["FLAGS_MACHINE_TOKEN"];
  const origin =
    env["FLAGS_PUBLIC_ORIGIN"] ?? "https://flags.tailnet-1a49.ts.net";
  const staticProxies = splitList(env["FLAGS_TRUSTED_PROXIES"]);
  const identityDir = env["FLAGS_INGRESS_IDENTITY_DIR"]?.trim();
  const hasIdentityDir = identityDir !== undefined && identityDir.length > 0;
  if (hasIdentityDir && staticProxies.length > 0) {
    throw new Error(
      "Set either FLAGS_TRUSTED_PROXIES or FLAGS_INGRESS_IDENTITY_DIR, not both",
    );
  }
  let trustedProxyAddresses: FlagsAuthConfig["trustedProxyAddresses"];
  if (hasIdentityDir) {
    trustedProxyAddresses = createFlagsTrustedProxyAddresses(
      createProjectedFlagsKubernetesReader(identityDir),
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
    operatorLogins: splitList(env["FLAGS_OPERATOR_LOGINS"]),
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
