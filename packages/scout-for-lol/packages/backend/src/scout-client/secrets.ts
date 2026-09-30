import { timingSafeEqual } from "node:crypto";

export function randomSecret(prefix = ""): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}${Buffer.from(bytes).toString("base64url")}`;
}

export function secretDigest(secret: string): string {
  return new Bun.CryptoHasher("sha256").update(secret).digest("hex");
}

export function digestMatches(secret: string, expectedDigest: string): boolean {
  const actual = Buffer.from(secretDigest(secret), "hex");
  const expected = Buffer.from(expectedDigest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
