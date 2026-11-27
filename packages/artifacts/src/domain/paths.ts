import {
  InvalidArtifactPathError,
  normalizeArtifactPath,
} from "#shared/contract.ts";

export type ResolvedPath = { type: "path"; path: string } | { type: "invalid" };

/**
 * Maps the part of a content URL after `/_t/<token>/` to a manifest path.
 * The empty path is the entry point and a trailing slash means `index.html`.
 * Percent-decoding happens once, and the result goes through the same
 * normalization an upload does, so traversal, backslashes, NUL and the
 * reserved `_` prefix are rejected rather than interpreted.
 */
export function resolveContentPath(
  rawRest: string,
  entryPath: string,
): ResolvedPath {
  if (rawRest === "") return { type: "path", path: entryPath };
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawRest);
  } catch {
    return { type: "invalid" };
  }
  const target = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  try {
    return { type: "path", path: normalizeArtifactPath(target) };
  } catch (error) {
    if (error instanceof InvalidArtifactPathError) return { type: "invalid" };
    throw error;
  }
}

const TOKEN_FORMAT = /^[\w-]{16,64}$/u;

export function isTokenFormat(token: string): boolean {
  return TOKEN_FORMAT.test(token);
}

/** 24 random bytes as unpadded base64url: 32 characters. */
export function mintContentToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString(
    "base64url",
  );
}
