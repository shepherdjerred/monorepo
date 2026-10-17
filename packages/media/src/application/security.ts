import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function matchesHash(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Ciphertexts are purpose-bound so another credential cannot be substituted. */
export class CredentialCipher {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    this.key = Buffer.from(encodedKey, "base64");
    if (this.key.length !== 32)
      throw new Error("Credential encryption key must contain 32 bytes");
  }

  encrypt(value: string, purpose: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(purpose));
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      nonce.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  }

  /** Secret-bearing command identities must not become offline password oracles. */
  fingerprint(value: string, purpose: string): string {
    const key = createHmac("sha256", this.key)
      .update("media:credential-command-key:v1")
      .digest();
    return createHmac("sha256", key)
      .update(JSON.stringify([purpose, value]))
      .digest("hex");
  }

  decrypt(envelope: string, purpose: string): string {
    const [version, nonce, tag, value, extra] = envelope.split(".");
    if (
      version !== "v1" ||
      nonce === undefined ||
      tag === undefined ||
      value === undefined ||
      extra !== undefined
    ) {
      throw new Error("Invalid encrypted credential envelope");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(value, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
