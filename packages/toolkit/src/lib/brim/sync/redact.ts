/**
 * Finds and overwrites leaked credentials in transcript bytes.
 *
 * A match counts only when it is standalone: the byte after it must not be a
 * token character (`[A-Za-z0-9+/=_-]`), and neither may the byte before it,
 * except `=`. That keeps substrings of base64 blobs, such as Codex
 * `encrypted_content`, from matching, while still catching `NAME=<secret>`:
 * base64 only uses `=` as trailing padding, so it never precedes more data.
 * The check is escape-aware: in JSON a secret after a newline follows `\n`,
 * so a JSON escape (`\b`, `\f`, `\n`, `\r`, `\t`, or a `\uXXXX` that is not
 * a token character) also counts as a boundary. It matches however deeply the
 * backslash is itself escaped, since a request body is a JSON string inside a
 * JSON spool record; base64 has no `\`, so blobs stay unmatched.
 *
 * Replacement is same-length (`REDACTED-<kind>` padded with `x`), so file
 * sizes and segment offsets never move and a CLI still appending to the file
 * is unaffected. Values are never returned, logged, or persisted: callers see
 * only offsets, lengths, and kinds.
 */

export const SECRET_KINDS = [
  "anthropic-key",
  "openai-key",
  "openai-session",
  "linear-key",
  "jwt",
  "onepassword-service-account",
  "github-token",
  "private-key",
  "private-key-base64",
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

export type SecretMatch = {
  readonly offset: number;
  readonly length: number;
  readonly kind: SecretKind;
};

const TOKEN_CHAR = /[\w+/=-]/;
const TOKEN_CHAR_BEFORE = /[\w+/-]/;
const ESCAPE_BEFORE = /\\(?:[bfnrt]|u([\dA-Fa-f]{4}))$/;

const PATTERNS: readonly { kind: SecretKind; pattern: RegExp }[] = [
  {
    kind: "anthropic-key",
    pattern: /sk-ant-(?:api|admin)\d\d-[\w-]{40,}/g,
  },
  { kind: "openai-key", pattern: /sk-proj-[\w-]{40,240}/g },
  // OpenAI/ChatGPT session keys (`sess-` plus 40 alphanumerics).
  { kind: "openai-session", pattern: /sess-[A-Za-z0-9]{40}/g },
  { kind: "linear-key", pattern: /lin_api_[A-Za-z0-9]{40}/g },
  {
    kind: "jwt",
    pattern: /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g,
  },
  // 1Password service-account tokens: `ops_` plus one base64 JSON segment.
  { kind: "onepassword-service-account", pattern: /ops_eyJ[\w+/=-]{100,}/g },
  {
    kind: "github-token",
    pattern: /(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_\w{22,255})/g,
  },
  // PEM private keys, raw or with JSON-escaped newlines (`\n`).
  {
    kind: "private-key",
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]{16,16384}?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
  },
  // base64 of `-----BEGIN …`, the kubeconfig/talosconfig form; confirmed below.
  {
    kind: "private-key-base64",
    pattern: /LS0tLS1CRUdJTi[A-Za-z0-9+/]{20,}={0,2}/g,
  },
];

function boundaryBefore(text: string, start: number): boolean {
  if (start === 0 || !TOKEN_CHAR_BEFORE.test(text.charAt(start - 1))) {
    return true;
  }
  const escape = ESCAPE_BEFORE.exec(text.slice(Math.max(0, start - 6), start));
  if (escape === null) return false;
  const hex = escape[1];
  return (
    hex === undefined ||
    !TOKEN_CHAR_BEFORE.test(String.fromCodePoint(Number.parseInt(hex, 16)))
  );
}

function standalone(text: string, start: number, end: number): boolean {
  const after = end >= text.length ? "" : text.charAt(end);
  return boundaryBefore(text, start) && !TOKEN_CHAR.test(after);
}

function decodesToObject(segment: string): boolean {
  try {
    const json: unknown = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8"),
    );
    return typeof json === "object" && json !== null && !Array.isArray(json);
  } catch {
    return false;
  }
}

/** True when a base64 PEM blob decodes to a private key, not a certificate. */
function isBase64PrivateKey(token: string): boolean {
  const decoded = Buffer.from(token, "base64").toString("latin1");
  return /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(decoded);
}

function isJwt(token: string): boolean {
  const [header, payload] = token.split(".");
  return (
    header !== undefined &&
    payload !== undefined &&
    decodesToObject(header) &&
    decodesToObject(payload)
  );
}

/**
 * Every standalone secret in `bytes`, by byte offset. The bytes are read as
 * latin1 so string offsets equal byte offsets; every pattern is ASCII.
 */
export function findSecrets(bytes: Uint8Array): SecretMatch[] {
  const text = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.length,
  ).toString("latin1");
  const matches: SecretMatch[] = [];
  for (const { kind, pattern } of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      // PEM armor is self-delimiting; in JSON it follows an escaped `\n`,
      // whose `n` would otherwise fail the standalone check.
      if (kind !== "private-key" && !standalone(text, start, end)) continue;
      if (kind === "jwt" && !isJwt(match[0])) continue;
      if (kind === "private-key-base64" && !isBase64PrivateKey(match[0])) {
        continue;
      }
      matches.push({ offset: start, length: match[0].length, kind });
    }
  }
  return matches.toSorted((a, b) => a.offset - b.offset);
}

/** The same-length marker written over a match. */
export function replacementFor(match: SecretMatch): Uint8Array {
  const label = `REDACTED-${match.kind}`.slice(0, match.length);
  return new TextEncoder().encode(label.padEnd(match.length, "x"));
}

/** A copy of `bytes` with every secret overwritten, plus what was found. */
export function redactBytes(bytes: Uint8Array): {
  readonly bytes: Uint8Array;
  readonly matches: readonly SecretMatch[];
} {
  const matches = findSecrets(bytes);
  if (matches.length === 0) return { bytes, matches };
  const redacted = Uint8Array.from(bytes);
  for (const match of matches) {
    redacted.set(replacementFor(match), match.offset);
  }
  return { bytes: redacted, matches };
}

export function countByKind(
  matches: readonly SecretMatch[],
): Partial<Record<SecretKind, number>> {
  const counts: Partial<Record<SecretKind, number>> = {};
  for (const match of matches) {
    counts[match.kind] = (counts[match.kind] ?? 0) + 1;
  }
  return counts;
}
