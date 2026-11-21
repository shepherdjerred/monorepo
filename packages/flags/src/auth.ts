import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export type FlagsAuthConfig = {
  readonly machineToken: string | undefined;
  readonly operatorLogins: readonly string[];
  readonly trustedProxyAddresses: readonly string[];
  readonly publicOrigin: string;
};

export type FlagsPrincipal =
  | { readonly kind: "machine" }
  | { readonly kind: "human"; readonly login: string };

export type AuthFailure = {
  readonly status: 401 | 403;
  readonly error: string;
};

const digest = (value: string) => createHash("sha256").update(value).digest();

function canonicalPeer(address: string): string {
  return address.startsWith("::ffff:") &&
    isIP(address) === 6 &&
    isIP(address.slice(7)) === 4
    ? address.slice(7)
    : address;
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
export function authenticate(
  request: Request,
  peerAddress: string | null,
  config: FlagsAuthConfig,
): FlagsPrincipal | AuthFailure {
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
  if (
    peerAddress === null ||
    !config.trustedProxyAddresses.includes(canonicalPeer(peerAddress))
  ) {
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
  return {
    machineToken: token === undefined || token.length === 0 ? undefined : token,
    operatorLogins: splitList(env["FLAGS_OPERATOR_LOGINS"]),
    trustedProxyAddresses: splitList(env["FLAGS_TRUSTED_PROXIES"]),
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
