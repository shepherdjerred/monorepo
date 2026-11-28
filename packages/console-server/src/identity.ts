import { createHash, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";

/** A tailnet person, as the Tailscale ingress proxy names them. */
export type ConsoleViewer = {
  readonly kind: "viewer";
  readonly login: string;
  readonly displayName: string | null;
};

/** A first-party caller holding a bearer token. */
export type ConsoleMachine = {
  readonly kind: "machine";
  readonly id: string;
  readonly scopes: readonly string[];
};

export type ConsoleIdentity =
  { readonly kind: "anonymous" } | ConsoleViewer | ConsoleMachine;

export const ANONYMOUS: ConsoleIdentity = { kind: "anonymous" };

/**
 * A credential that was presented and failed. The server answers it with the
 * status and message, whatever the route, so a bad token never quietly
 * downgrades to anonymous.
 */
export class IdentityRejectedError extends Error {
  override readonly name = "IdentityRejectedError";
  readonly status: 401 | 403 | 503;

  constructor(status: 401 | 403 | 503, message: string) {
    super(message);
    this.status = status;
  }
}

export type IdentityRequest = {
  readonly request: Request;
  /** The TCP peer, from `Bun.serve`'s `requestIP`; `null` in `app.request` tests. */
  readonly peerAddress: string | null;
};

/**
 * One way to identify a request. Returns `undefined` when the request does not
 * use this scheme (no bearer header, say), so the next scheme is tried.
 */
export type IdentityScheme = (
  request: IdentityRequest,
) => Promise<ConsoleIdentity | undefined>;

/** The first scheme that applies wins; a request no scheme claims is anonymous. */
export async function resolveIdentity(
  schemes: readonly IdentityScheme[],
  request: IdentityRequest,
): Promise<ConsoleIdentity> {
  for (const scheme of schemes) {
    const identity = await scheme(request);
    if (identity !== undefined) return identity;
  }
  return ANONYMOUS;
}

// ── Trusted proxy addresses ────────────────────────────────────────────────

/**
 * Exact addresses or CIDR subnets of the proxy that inserts Tailscale identity
 * headers, or a function that resolves them per request (Flags and Feeds
 * verify their ingress proxy Pods through the Kubernetes API).
 */
export type TrustedProxies =
  readonly string[] | (() => Promise<readonly string[]>);

/** The in-Pod Tailscale sidecar, which proxies from loopback (Go link). */
export const LOOPBACK_PROXIES: readonly string[] = ["127.0.0.1", "::1"];

/** `a.b.c.d` or an IPv6 address, optionally `/<prefix>`; nothing else. */
const PROXY_ENTRY = /^(?<address>[^/]+)(?:\/(?<prefix>0|[1-9]\d{0,2}))?$/u;

type Peer = { readonly address: string; readonly family: "ipv4" | "ipv6" };

/** An IPv4-mapped IPv6 peer (`::ffff:10.0.0.1`) is its IPv4 address. */
function toPeer(raw: string): Peer | undefined {
  const mapped = raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : "";
  const address = isIP(mapped) === 4 ? mapped : raw;
  switch (isIP(address)) {
    case 4: {
      return { address, family: "ipv4" };
    }
    case 6: {
      return { address, family: "ipv6" };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Builds a `BlockList` of exact proxy addresses and CIDR subnets, failing on
 * any malformed entry so a bad configuration never silently fails open or
 * closed (the rule Flags' and Feeds' `parseTrustedProxyBlockList` apply).
 */
export function parseTrustedProxies(entries: readonly string[]): BlockList {
  const blockList = new BlockList();
  for (const entry of entries) {
    const groups = PROXY_ENTRY.exec(entry)?.groups;
    const peer =
      groups?.["address"] === undefined ? undefined : toPeer(groups["address"]);
    const rawPrefix = groups?.["prefix"];
    const prefix = rawPrefix === undefined ? undefined : Number(rawPrefix);
    const maxPrefix = peer?.family === "ipv4" ? 32 : 128;
    if (peer === undefined || (prefix !== undefined && prefix > maxPrefix)) {
      throw new Error(`Invalid trusted proxy entry: ${entry}`);
    }
    if (prefix === undefined) {
      blockList.addAddress(peer.address, peer.family);
    } else {
      blockList.addSubnet(peer.address, prefix, peer.family);
    }
  }
  return blockList;
}

async function trustedBlockList(
  trusted: TrustedProxies,
  fixed: BlockList | undefined,
): Promise<BlockList> {
  if (fixed !== undefined) return fixed;
  if (typeof trusted !== "function") return parseTrustedProxies(trusted);
  try {
    return parseTrustedProxies(await trusted());
  } catch {
    throw new IdentityRejectedError(
      503,
      "private ingress identity verification unavailable",
    );
  }
}

function isTrustedPeer(blockList: BlockList, peerAddress: string): boolean {
  const peer = toPeer(peerAddress);
  return peer !== undefined && blockList.check(peer.address, peer.family);
}

function headerValue(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type TailscaleIdentityOptions = {
  readonly trustedProxies: TrustedProxies;
  /**
   * Reject requests that do not arrive through the proxy with a login (401)
   * instead of treating them as anonymous. Flags, Feeds and Delivery need
   * this; Go link serves anonymous readers.
   */
  readonly required?: boolean;
  /** Only these logins are accepted (403 otherwise). */
  readonly operatorLogins?: readonly string[];
  /**
   * The console's browser origin. A viewer's state-changing request must send
   * it as `Origin` (403 otherwise).
   */
  readonly publicOrigin?: string;
};

/**
 * Tailscale identity headers (`tailscale-user-login`, `tailscale-user-name`)
 * are trusted only from a trusted proxy peer; from anywhere else they are
 * ignored, so a spoofed header never names a viewer.
 */
export function tailscaleIdentity(
  options: TailscaleIdentityOptions,
): IdentityScheme {
  const fixed =
    typeof options.trustedProxies === "function"
      ? undefined
      : parseTrustedProxies(options.trustedProxies);
  const expectedOrigin =
    options.publicOrigin === undefined
      ? undefined
      : new URL(options.publicOrigin).origin;
  const required = options.required === true;

  return async ({ request, peerAddress }) => {
    const blockList =
      peerAddress === null
        ? undefined
        : await trustedBlockList(options.trustedProxies, fixed);
    const trusted =
      blockList !== undefined &&
      peerAddress !== null &&
      isTrustedPeer(blockList, peerAddress);
    if (!trusted) {
      if (required) {
        throw new IdentityRejectedError(
          401,
          "authenticated private ingress required",
        );
      }
      return ANONYMOUS;
    }
    const login = headerValue(request, "tailscale-user-login");
    if (login === null) {
      if (required) {
        throw new IdentityRejectedError(
          403,
          "operator identity is not authorized",
        );
      }
      return ANONYMOUS;
    }
    if (
      options.operatorLogins !== undefined &&
      !options.operatorLogins.includes(login)
    ) {
      throw new IdentityRejectedError(
        403,
        "operator identity is not authorized",
      );
    }
    if (
      expectedOrigin !== undefined &&
      !IDEMPOTENT_METHODS.has(request.method.toUpperCase()) &&
      request.headers.get("origin") !== expectedOrigin
    ) {
      throw new IdentityRejectedError(
        403,
        "same-origin browser request required",
      );
    }
    return {
      kind: "viewer",
      login,
      displayName: headerValue(request, "tailscale-user-name"),
    };
  };
}

// ── Machine tokens ─────────────────────────────────────────────────────────

export type MachineCredential = {
  /** Who holds the token, e.g. `temporal` or `toolkit`. */
  readonly id: string;
  readonly token: string;
  readonly scopes: readonly string[];
};

const digest = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

/**
 * `Authorization: Bearer <token>` for first-party callers, compared in
 * constant time as Delivery's `authenticate` does. A request without the
 * header is left to the next scheme; a wrong token is rejected with 401.
 */
export function machineToken(options: {
  readonly credentials: readonly MachineCredential[];
}): IdentityScheme {
  const seen = new Set<string>();
  const known = options.credentials.map((credential) => {
    if (credential.token.length === 0) {
      throw new Error(`Machine credential ${credential.id} has an empty token`);
    }
    if (seen.has(credential.token)) {
      throw new Error(`Machine credential ${credential.id} reuses a token`);
    }
    seen.add(credential.token);
    return { credential, digest: digest(credential.token) };
  });

  return ({ request }) => {
    const authorization = request.headers.get("authorization");
    if (authorization === null) return Promise.resolve(undefined);
    if (!authorization.startsWith("Bearer ")) {
      return Promise.reject(
        new IdentityRejectedError(401, "Bearer authentication required"),
      );
    }
    const supplied = digest(authorization.slice("Bearer ".length));
    const matches = known.filter((entry) =>
      timingSafeEqual(supplied, entry.digest),
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match === undefined) {
      return Promise.reject(
        new IdentityRejectedError(401, "invalid machine credential"),
      );
    }
    return Promise.resolve({
      kind: "machine",
      id: match.credential.id,
      scopes: match.credential.scopes,
    });
  };
}
