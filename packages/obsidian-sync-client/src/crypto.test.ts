import { describe, test, expect } from "bun:test";
import {
  deriveScryptKey,
  createEncryptionProvider,
  aesGcmEncrypt,
  aesGcmDecrypt,
  hexEncode,
  hexDecode,
  textToBuffer,
  bufferToText,
} from "./crypto.ts";
const { subtle } = globalThis.crypto;

function randomKeyBuffer(): ArrayBuffer {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const buf = new ArrayBuffer(32);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function cloneBuffer(buffer: ArrayBuffer): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(new Uint8Array(buffer));
  return copy;
}

describe("hex encoding", () => {
  test("round-trip hex encode/decode", () => {
    const original = new Uint8Array([0, 1, 127, 128, 255]).buffer;
    const hex = hexEncode(original);
    expect(hex).toBe("00017f80ff");
    const decoded = hexDecode(hex);
    expect(new Uint8Array(decoded)).toEqual(new Uint8Array(original));
  });

  test("empty buffer", () => {
    const empty = new ArrayBuffer(0);
    const hex = hexEncode(empty);
    expect(hex).toBe("");
    const decoded = hexDecode(hex);
    expect(decoded.byteLength).toBe(0);
  });
});

describe("text encoding", () => {
  test("round-trip text to buffer", () => {
    const text = "Hello, World!";
    const buffer = textToBuffer(text);
    const result = bufferToText(buffer);
    expect(result).toBe(text);
  });

  test("unicode text", () => {
    const text = "Hello \u{1F600} World";
    const buffer = textToBuffer(text);
    const result = bufferToText(buffer);
    expect(result).toBe(text);
  });
});

describe("scrypt key derivation", () => {
  test("derives a 32-byte key", async () => {
    const key = await deriveScryptKey("password", "salt");
    expect(key.byteLength).toBe(32);
  });

  test("same inputs produce same key", async () => {
    const key1 = await deriveScryptKey("password", "salt");
    const key2 = await deriveScryptKey("password", "salt");
    expect(hexEncode(key1)).toBe(hexEncode(key2));
  });

  test("different inputs produce different keys", async () => {
    const key1 = await deriveScryptKey("password1", "salt");
    const key2 = await deriveScryptKey("password2", "salt");
    expect(hexEncode(key1)).not.toBe(hexEncode(key2));
  });

  test("NFKC normalization", async () => {
    const key1 = await deriveScryptKey("\u00E9", "salt");
    const key2 = await deriveScryptKey("e\u0301", "salt");
    expect(key1.byteLength).toBe(32);
    expect(key2.byteLength).toBe(32);
  });
});

describe("AES-GCM encrypt/decrypt", () => {
  test("round-trip encrypt/decrypt", async () => {
    const key = await subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(32)),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );

    const plaintext = textToBuffer("Hello, World!");
    const ciphertext = await aesGcmEncrypt(plaintext, key);
    expect(ciphertext.byteLength).toBe(12 + plaintext.byteLength + 16);

    const decrypted = await aesGcmDecrypt(ciphertext, key);
    expect(bufferToText(decrypted)).toBe("Hello, World!");
  });

  test("empty plaintext", async () => {
    const key = await subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(32)),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );

    const plaintext = new ArrayBuffer(0);
    const ciphertext = await aesGcmEncrypt(plaintext, key);
    expect(ciphertext.byteLength).toBe(12 + 16);

    const decrypted = await aesGcmDecrypt(ciphertext, key);
    expect(decrypted.byteLength).toBe(0);
  });

  test("rejects truncated data", async () => {
    const key = await subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(32)),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );

    await expect(aesGcmDecrypt(new ArrayBuffer(5), key)).rejects.toThrow(
      "Encrypted data is bad",
    );
  });

  test("exactly 12 bytes returns empty buffer", async () => {
    const key = await subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(32)),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );

    const result = await aesGcmDecrypt(new ArrayBuffer(12), key);
    expect(result.byteLength).toBe(0);
  });
});

describe("encryption provider", () => {
  test("creates v3 provider", async () => {
    const provider = await createEncryptionProvider(3, randomKeyBuffer(), "test-salt");
    expect(provider.encryptionVersion).toBe(3);
    expect(provider.keyHash).toBeTruthy();
    expect(provider.keyHash.length).toBe(64);
  });

  test("round-trip encrypt/decrypt", async () => {
    const provider = await createEncryptionProvider(3, randomKeyBuffer(), "test-salt");
    const plaintext = textToBuffer("Secret message");
    const encrypted = await provider.encrypt(plaintext);
    const decrypted = await provider.decrypt(encrypted);
    expect(bufferToText(decrypted)).toBe("Secret message");
  });

  test("round-trip deterministic encode/decode", async () => {
    const provider = await createEncryptionProvider(3, randomKeyBuffer(), "test-salt");
    const filePath = "folder/subfolder/document.md";
    const encoded = await provider.deterministicEncodeStr(filePath);
    const decoded = await provider.deterministicDecodeStr(encoded);
    expect(decoded).toBe(filePath);
  });

  test("deterministic encoding is consistent", async () => {
    const provider = await createEncryptionProvider(3, randomKeyBuffer(), "test-salt");
    const filePath = "test.md";
    const encoded1 = await provider.deterministicEncodeStr(filePath);
    const encoded2 = await provider.deterministicEncodeStr(filePath);
    expect(encoded1).toBe(encoded2);
  });

  test("different paths produce different encodings", async () => {
    const provider = await createEncryptionProvider(3, randomKeyBuffer(), "test-salt");
    const encoded1 = await provider.deterministicEncodeStr("file1.md");
    const encoded2 = await provider.deterministicEncodeStr("file2.md");
    expect(encoded1).not.toBe(encoded2);
  });

  test("same key + salt produce same keyhash", async () => {
    const key = randomKeyBuffer();
    const provider1 = await createEncryptionProvider(3, cloneBuffer(key), "test-salt");
    const provider2 = await createEncryptionProvider(3, cloneBuffer(key), "test-salt");
    expect(provider1.keyHash).toBe(provider2.keyHash);
  });

  test("rejects unsupported encryption versions", async () => {
    const key = randomKeyBuffer();
    await expect(
      createEncryptionProvider(1, key, "test-salt"),
    ).rejects.toThrow("not supported");
    await expect(
      createEncryptionProvider(99, key, "test-salt"),
    ).rejects.toThrow("not supported");
  });

  test("creates v0 provider", async () => {
    const provider = await createEncryptionProvider(0, randomKeyBuffer(), "test-salt");
    expect(provider.encryptionVersion).toBe(0);
    expect(provider.keyHash).toHaveLength(64); // SHA-256 hex
    const filePath = "test/path.md";
    const encoded = await provider.deterministicEncodeStr(filePath);
    const decoded = await provider.deterministicDecodeStr(encoded);
    expect(decoded).toBe(filePath);
  });

  test("creates v2 provider (same as v3 internally)", async () => {
    const provider = await createEncryptionProvider(2, randomKeyBuffer(), "test-salt");
    expect(provider.encryptionVersion).toBe(3);
    const filePath = "test/path.md";
    const encoded = await provider.deterministicEncodeStr(filePath);
    const decoded = await provider.deterministicDecodeStr(encoded);
    expect(decoded).toBe(filePath);
  });

  test("encrypt/decrypt large binary data", async () => {
    const provider = await createEncryptionProvider(3, randomKeyBuffer(), "test-salt");
    const plainBytes = crypto.getRandomValues(new Uint8Array(1024 * 1024));
    const plaintext = new ArrayBuffer(plainBytes.byteLength);
    new Uint8Array(plaintext).set(plainBytes);
    const encrypted = await provider.encrypt(plaintext);
    const decrypted = await provider.decrypt(encrypted);
    expect(new Uint8Array(decrypted)).toEqual(new Uint8Array(plaintext));
  });

  test("encode/decode unicode paths", async () => {
    const provider = await createEncryptionProvider(3, randomKeyBuffer(), "test-salt");
    const filePath = "\u65E5\u672C\u8A9E/\u30C9\u30AD\u30E5\u30E1\u30F3\u30C8.md";
    const encoded = await provider.deterministicEncodeStr(filePath);
    const decoded = await provider.deterministicDecodeStr(encoded);
    expect(decoded).toBe(filePath);
  });
});
