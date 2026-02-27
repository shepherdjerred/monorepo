import { scrypt } from "node:crypto";
import { AesSiv } from "./aes-siv.ts";

// Use globalThis.crypto.subtle instead of node:crypto's subtle to avoid
// type incompatibility between webcrypto.CryptoKey and global CryptoKey.
const { subtle } = globalThis.crypto;

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;
const SCRYPT_MAXMEM = 67_108_864;
const AES_GCM_IV_SIZE = 12;

// --- Low-level helpers ---

function toArrayBuffer(typed: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(typed.byteLength);
  new Uint8Array(ab).set(typed);
  return ab;
}

function hexEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const hex: string[] = [];
  for (const byte of bytes) {
    hex.push((byte >>> 4).toString(16));
    hex.push((byte & 0x0F).toString(16));
  }
  return hex.join("");
}

function hexDecode(hex: string): ArrayBuffer {
  const length = hex.length / 2;
  const buffer = new ArrayBuffer(length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < length; i++) {
    bytes[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return buffer;
}

function textToBuffer(text: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(text));
}

function bufferToText(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(buffer));
}

// --- scrypt key derivation ---

export function deriveScryptKey(
  password: string,
  salt: string,
): Promise<ArrayBuffer> {
  const normalizedPassword = password.normalize("NFKC");
  const normalizedSalt = salt.normalize("NFKC");
  return new Promise((resolve, reject) => {
    scrypt(
      Buffer.from(normalizedPassword, "utf8"),
      Buffer.from(normalizedSalt, "utf8"),
      SCRYPT_DKLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (error, derivedKey) => {
        if (error) {
          reject(error);
        } else {
          resolve(toArrayBuffer(derivedKey));
        }
      },
    );
  });
}

// --- HKDF key derivations ---

async function importHkdfBaseKey(rawKey: ArrayBuffer): Promise<CryptoKey> {
  return subtle.importKey("raw", rawKey, "HKDF", false, ["deriveKey"]);
}

async function deriveKeyHash(
  baseKey: CryptoKey,
  vaultSalt: string,
): Promise<string> {
  const salt = textToBuffer(vaultSalt);
  const info = textToBuffer("ObsidianKeyHash");
  const derivedKey = await subtle.deriveKey(
    { name: "HKDF", salt, info, hash: "SHA-256" },
    baseKey,
    { name: "AES-CBC", length: 256 },
    true,
    ["encrypt"],
  );
  const rawKey = await subtle.exportKey("raw", derivedKey);
  return hexEncode(rawKey);
}

async function deriveAesGcmKey(baseKey: CryptoKey): Promise<CryptoKey> {
  return subtle.deriveKey(
    {
      name: "HKDF",
      salt: new Uint8Array(),
      info: textToBuffer("ObsidianAesGcm"),
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function deriveSivEncKey(
  baseKey: CryptoKey,
  vaultSalt: string,
): Promise<CryptoKey> {
  return subtle.deriveKey(
    {
      name: "HKDF",
      salt: textToBuffer(vaultSalt),
      info: new TextEncoder().encode("ObsidianAesSivEnc"),
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-CTR", length: 256 },
    false,
    ["encrypt"],
  );
}

async function deriveSivMacKey(
  baseKey: CryptoKey,
  vaultSalt: string,
): Promise<CryptoKey> {
  return subtle.deriveKey(
    {
      name: "HKDF",
      salt: textToBuffer(vaultSalt),
      info: new TextEncoder().encode("ObsidianAesSivMac"),
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-CBC", length: 256 },
    false,
    ["encrypt"],
  );
}

// --- AES-256-GCM encrypt/decrypt ---

export async function aesGcmEncrypt(
  data: ArrayBuffer,
  key: CryptoKey,
  iv?: Uint8Array,
): Promise<ArrayBuffer> {
  iv ??= crypto.getRandomValues(new Uint8Array(AES_GCM_IV_SIZE));
  const ivCopy = new Uint8Array(iv.byteLength);
  ivCopy.set(iv);
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv: ivCopy },
    key,
    data,
  );
  const result = new ArrayBuffer(iv.byteLength + ciphertext.byteLength);
  const resultView = new Uint8Array(result);
  resultView.set(new Uint8Array(iv), 0);
  resultView.set(new Uint8Array(ciphertext), iv.byteLength);
  return result;
}

export async function aesGcmDecrypt(
  data: ArrayBuffer,
  key: CryptoKey,
): Promise<ArrayBuffer> {
  if (data.byteLength < AES_GCM_IV_SIZE) {
    throw new Error("Encrypted data is bad");
  }
  if (data.byteLength === AES_GCM_IV_SIZE) {
    return new ArrayBuffer(0);
  }
  const ivCopy = new Uint8Array(AES_GCM_IV_SIZE);
  ivCopy.set(new Uint8Array(data, 0, AES_GCM_IV_SIZE));
  const ciphertext = new Uint8Array(data, AES_GCM_IV_SIZE);
  return subtle.decrypt({ name: "AES-GCM", iv: ivCopy }, key, ciphertext);
}

// --- Encryption Provider ---

export type EncryptionProvider = {
  keyHash: string;
  encryptionVersion: number;
  encrypt: (data: ArrayBuffer) => Promise<ArrayBuffer>;
  decrypt: (data: ArrayBuffer) => Promise<ArrayBuffer>;
  deterministicEncodeStr: (text: string) => Promise<string>;
  deterministicDecodeStr: (hex: string) => Promise<string>;
};

async function createV3Provider(
  rawKey: ArrayBuffer,
  vaultSalt: string,
): Promise<EncryptionProvider> {
  const baseKey = await importHkdfBaseKey(rawKey);
  const keyHash = await deriveKeyHash(baseKey, vaultSalt);
  const gcmKey = await deriveAesGcmKey(baseKey);
  const sivEncKey = await deriveSivEncKey(baseKey, vaultSalt);
  const sivMacKey = await deriveSivMacKey(baseKey, vaultSalt);
  const siv = await AesSiv.importKeys(sivEncKey, sivMacKey);

  return {
    keyHash,
    encryptionVersion: 3,

    async encrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
      return aesGcmEncrypt(data, gcmKey);
    },

    async decrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
      return aesGcmDecrypt(data, gcmKey);
    },

    async deterministicEncodeStr(text: string): Promise<string> {
      const plaintext = new Uint8Array(textToBuffer(text));
      const sealed = await siv.seal(plaintext);
      return hexEncode(toArrayBuffer(sealed));
    },

    async deterministicDecodeStr(hex: string): Promise<string> {
      const ciphertext = new Uint8Array(hexDecode(hex));
      const plaintext = await siv.open(ciphertext);
      return bufferToText(toArrayBuffer(plaintext));
    },
  };
}

async function createV0Provider(
  rawKey: ArrayBuffer,
): Promise<EncryptionProvider> {
  if (rawKey.byteLength !== 32) {
    throw new Error("Invalid encryption key");
  }
  const keyHashBuffer = await subtle.digest("SHA-256", new Uint8Array(rawKey));
  const keyHash = hexEncode(keyHashBuffer);
  const gcmKey = await subtle.importKey(
    "raw",
    rawKey,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );

  return {
    keyHash,
    encryptionVersion: 0,

    async encrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
      return aesGcmEncrypt(data, gcmKey);
    },

    async decrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
      return aesGcmDecrypt(data, gcmKey);
    },

    async deterministicEncodeStr(text: string): Promise<string> {
      const plaintext = textToBuffer(text);
      const hash = await subtle.digest("SHA-256", new Uint8Array(plaintext));
      const iv = new Uint8Array(hash, 0, AES_GCM_IV_SIZE);
      const encrypted = await aesGcmEncrypt(plaintext, gcmKey, iv);
      return hexEncode(encrypted);
    },

    async deterministicDecodeStr(hex: string): Promise<string> {
      const ciphertext = hexDecode(hex);
      const plaintext = await aesGcmDecrypt(ciphertext, gcmKey);
      return bufferToText(plaintext);
    },
  };
}

export async function createEncryptionProvider(
  encryptionVersion: number,
  rawKey: ArrayBuffer,
  vaultSalt: string,
): Promise<EncryptionProvider> {
  if (encryptionVersion === 0) {
    return createV0Provider(rawKey);
  }
  if (encryptionVersion === 2 || encryptionVersion === 3) {
    return createV3Provider(rawKey, vaultSalt);
  }
  throw new Error(
    `Encryption version ${String(encryptionVersion)} not supported`,
  );
}

export { hexEncode, hexDecode, textToBuffer, bufferToText };
