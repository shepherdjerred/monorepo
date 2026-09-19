import type { FetchLike } from "#src/http.ts";
import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { createVerifier, httpbis } from "http-message-signatures";

/**
 * Components Woodpecker covers with its signature.
 *
 * `server/services/utils/http.go` signs exactly `@request-target` and
 * `content-digest` with an ed25519 key under the signature name
 * `woodpecker-ci-extensions`. Requiring both here means a signature that omits
 * either is rejected rather than silently accepted as covering less than we
 * think it does.
 */
const REQUIRED_SIGNED_COMPONENTS = ["@request-target", "content-digest"];

/** Path on the Woodpecker server that publishes the signing public key. */
export const PUBLIC_KEY_PATH = "/api/signature/public-key";

export type SignedRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
};

/**
 * Recompute the body digest and compare it to the signed `Content-Digest`.
 *
 * The signature covers the Content-Digest HEADER, not the body itself. Without
 * this check a captured header set could be replayed against a substituted
 * body and still verify — and the body is what becomes an executed pipeline.
 * Supports only sha-256 and sha-512, the algorithms RFC 9530 registers and
 * Woodpecker emits; anything else is treated as unverifiable.
 */
export function contentDigestMatches(
  headerValue: string | undefined,
  body: string,
): boolean {
  if (headerValue === undefined || headerValue.length === 0) return false;
  // RFC 9530 dictionary form: `sha-256=:<base64>:`, possibly several entries.
  const entries = headerValue.split(",");
  let checkedAny = false;
  for (const entry of entries) {
    const match = /^\s*(?<alg>sha-256|sha-512)=:(?<digest>[^:]*):\s*$/u.exec(
      entry,
    );
    const alg = match?.groups?.["alg"];
    const digest = match?.groups?.["digest"];
    if (alg === undefined || digest === undefined) {
      // An entry we cannot parse must not be silently skipped — a signature
      // covering only an unknown algorithm would otherwise pass unchecked.
      return false;
    }
    const expected = createHash(alg === "sha-256" ? "sha256" : "sha512")
      .update(body)
      .digest("base64");
    if (expected !== digest) return false;
    checkedAny = true;
  }
  return checkedAny;
}

/**
 * Fetch and parse Woodpecker's ed25519 public key.
 *
 * The server publishes it in PEM form. It is stable for the life of the
 * instance, so callers cache it, but a restart with a regenerated key must be
 * recoverable without redeploying the extension.
 */
export async function fetchPublicKey(
  serverUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<KeyObject> {
  const response = await fetchImpl(`${serverUrl}${PUBLIC_KEY_PATH}`);
  if (!response.ok) {
    throw new Error(
      `could not fetch Woodpecker signing key (${response.status.toString()})`,
    );
  }
  return createPublicKey(await response.text());
}

/**
 * Verify a configuration-extension request came from Woodpecker.
 *
 * Both halves are required: the RFC 9421 signature proves the covered
 * components were produced by the holder of the private key, and the digest
 * comparison binds those components to this exact body.
 */
export async function verifySignedRequest(
  request: SignedRequest,
  publicKey: KeyObject,
): Promise<boolean> {
  if (!contentDigestMatches(request.headers["content-digest"], request.body)) {
    return false;
  }
  const verifier = createVerifier(publicKey, "ed25519");
  const verified = await httpbis.verifyMessage(
    {
      // Constrain the key to ed25519 so a forged `alg` parameter cannot
      // downgrade verification to a weaker or attacker-chosen algorithm.
      keyLookup: () => Promise.resolve({ algs: ["ed25519"], verify: verifier }),
      requiredFields: REQUIRED_SIGNED_COMPONENTS,
    },
    {
      method: request.method,
      url: request.url,
      headers: request.headers,
    },
  );
  // `verifyMessage` returns null when the message carries no signature at all.
  return verified === true;
}
