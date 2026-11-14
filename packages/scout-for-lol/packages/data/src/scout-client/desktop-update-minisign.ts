import { createHash, createPublicKey, verify } from "node:crypto";

/**
 * Verifies the minisign signatures `cargo packager` writes for desktop
 * installers, the same check the Rust client makes (`minisign-verify`) before
 * it runs one. The publication script uses it so an installer signed with the
 * wrong key, or not signed at all, never reaches the bucket.
 *
 * Node only (`node:crypto`); it is deliberately not exported from the package
 * index.
 */

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32-byte key follows.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const TRUSTED_COMMENT_PREFIX = "trusted comment: ";

function decodeText(base64: string, what: string): string[] {
  const text = Buffer.from(base64.trim(), "base64").toString("utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error(`${what} is not base64 minisign text`);
  }
  return lines;
}

function ed25519Key(publicKey: Buffer) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
    format: "der",
    type: "spki",
  });
}

/**
 * Throws unless `signatureBase64` (the content of a `.sig` file `cargo
 * packager` wrote) is a valid prehashed minisign signature of `data` by
 * `publicKeyBase64` (the `update_public_key` of a release profile).
 */
export function verifyMinisign(input: {
  publicKeyBase64: string;
  signatureBase64: string;
  data: Uint8Array;
}): void {
  const keyLines = decodeText(input.publicKeyBase64, "the public key");
  const keyBytes = Buffer.from(keyLines[1] ?? "", "base64");
  if (keyBytes.length !== 42 || keyBytes.subarray(0, 2).toString() !== "Ed") {
    throw new Error("The public key is not a minisign Ed25519 key");
  }
  const keyId = keyBytes.subarray(2, 10);
  const key = ed25519Key(keyBytes.subarray(10));

  const lines = decodeText(input.signatureBase64, "the signature");
  const signature = Buffer.from(lines[1] ?? "", "base64");
  if (signature.length !== 74) {
    throw new Error("The signature is not a minisign signature");
  }
  // "ED" is the prehashed variant, the only one the client accepts.
  if (signature.subarray(0, 2).toString() !== "ED") {
    throw new Error("The signature is not a prehashed minisign signature");
  }
  if (!signature.subarray(2, 10).equals(keyId)) {
    throw new Error("The signature was made by a different key");
  }
  const raw = signature.subarray(10);
  const digest = createHash("blake2b512").update(input.data).digest();
  if (!verify(null, digest, key, raw)) {
    throw new Error("The signature does not match the file");
  }

  const comment = lines[2] ?? "";
  const global = Buffer.from(lines[3] ?? "", "base64");
  if (!comment.startsWith(TRUSTED_COMMENT_PREFIX) || global.length !== 64) {
    throw new Error("The signature has no trusted comment");
  }
  const trusted = Buffer.from(comment.slice(TRUSTED_COMMENT_PREFIX.length));
  if (!verify(null, Buffer.concat([raw, trusted]), key, global)) {
    throw new Error("The signature's trusted comment was altered");
  }
}
