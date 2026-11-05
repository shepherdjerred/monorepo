import { createHash } from "node:crypto";
import { Decrypter, Encrypter } from "age-encryption";
import { SyncSetupError } from "./errors.ts";

/**
 * Every object `brim sync` writes is zstd-compressed and then age-encrypted
 * to one X25519 recipient. Pushing needs only the public recipient, so a
 * machine that only uploads never holds the decryption identity.
 */

const RECIPIENT_PATTERN = /^age1[0-9a-z]{58}$/;
const IDENTITY_PREFIX = "AGE-SECRET-KEY-1";

export function assertRecipient(recipient: string): string {
  if (!RECIPIENT_PATTERN.test(recipient)) {
    throw new SyncSetupError(
      "brim sync recipient must be an age X25519 public key (age1…).",
    );
  }
  return recipient;
}

export function assertIdentity(identity: string): string {
  const trimmed = identity.trim();
  if (!trimmed.startsWith(IDENTITY_PREFIX)) {
    throw new SyncSetupError(
      "BRIM_SYNC_AGE_IDENTITY must be an age X25519 identity (AGE-SECRET-KEY-1…).",
    );
  }
  return trimmed;
}

export type Sealer = (plaintext: Uint8Array) => Promise<Uint8Array>;
export type Opener = (sealed: Uint8Array) => Promise<Uint8Array>;

export function createSealer(recipient: string): Sealer {
  assertRecipient(recipient);
  return async (plaintext) => {
    const encrypter = new Encrypter();
    encrypter.addRecipient(recipient);
    return encrypter.encrypt(Bun.zstdCompressSync(plaintext, { level: 6 }));
  };
}

export function createOpener(identity: string): Opener {
  const key = assertIdentity(identity);
  return async (sealed) => {
    const decrypter = new Decrypter();
    decrypter.addIdentity(key);
    const compressed = await decrypter.decrypt(sealed);
    return new Uint8Array(Bun.zstdDecompressSync(compressed));
  };
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}
