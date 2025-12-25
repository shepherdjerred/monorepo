import { getConfig } from "../config/index.js";

/**
 * Simple encryption for GitHub tokens using XOR with the JWT secret.
 * For production, consider using a proper encryption library like sodium.
 */

function getKey(): Uint8Array {
  const config = getConfig();
  const encoder = new TextEncoder();
  return encoder.encode(config.JWT_SECRET);
}

export function encryptToken(token: string): string {
  const key = getKey();
  const encoder = new TextEncoder();
  const data = encoder.encode(token);

  const encrypted = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const dataByte = data[i];
    const keyByte = key[i % key.length];
    if (dataByte !== undefined && keyByte !== undefined) {
      encrypted[i] = dataByte ^ keyByte;
    }
  }

  // Convert to base64
  return Buffer.from(encrypted).toString("base64");
}

export function decryptToken(encrypted: string): string {
  const key = getKey();
  const data = Buffer.from(encrypted, "base64");

  const decrypted = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const dataByte = data[i];
    const keyByte = key[i % key.length];
    if (dataByte !== undefined && keyByte !== undefined) {
      decrypted[i] = dataByte ^ keyByte;
    }
  }

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
