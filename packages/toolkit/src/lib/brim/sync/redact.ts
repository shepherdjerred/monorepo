/**
 * Finds and overwrites leaked credentials in transcript bytes.
 *
 * A match counts only when it is standalone: the byte after it must not be a
 * token character (`[A-Za-z0-9+/=_-]`), and neither may the byte before it,
 * except `=`. That keeps substrings of base64 blobs, such as Codex
 * `encrypted_content`, from matching, while still catching `NAME=<secret>`:
 * base64 only uses `=` as trailing padding, so it never precedes more data.
 *
 * Replacement is same-length (`REDACTED-<kind>` padded with `x`), so file
 * sizes and segment offsets never move and a CLI still appending to the file
 * is unaffected. Values are never returned, logged, or persisted: callers see
 * only offsets, lengths, and kinds.
 */

export const SECRET_KINDS = [
  "anthropic-key",
  "openai-key",
  "linear-key",
  "jwt",
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

export type SecretMatch = {
  readonly offset: number;
  readonly length: number;
  readonly kind: SecretKind;
};

const TOKEN_CHAR = /[\w+/=-]/;
const TOKEN_CHAR_BEFORE = /[\w+/-]/;

const PATTERNS: readonly { kind: SecretKind; pattern: RegExp }[] = [
  {
    kind: "anthropic-key",
    pattern: /sk-ant-(?:api|admin)\d\d-[\w-]{40,}/g,
  },
  { kind: "openai-key", pattern: /sk-proj-[\w-]{40,240}/g },
  { kind: "linear-key", pattern: /lin_api_[A-Za-z0-9]{40}/g },
  {
    kind: "jwt",
    pattern: /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g,
  },
];

function standalone(text: string, start: number, end: number): boolean {
  const before = start === 0 ? "" : text.charAt(start - 1);
  const after = end >= text.length ? "" : text.charAt(end);
  return !TOKEN_CHAR_BEFORE.test(before) && !TOKEN_CHAR.test(after);
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
      if (!standalone(text, start, end)) continue;
      if (kind === "jwt" && !isJwt(match[0])) continue;
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
