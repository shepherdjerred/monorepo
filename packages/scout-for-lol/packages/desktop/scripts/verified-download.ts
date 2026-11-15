// Shared by fetch-voice-models.ts and fetch-sherpa-libs.ts: every download is
// checked against a pinned SHA-256 before it is used.
import { createHash } from "node:crypto";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function download(
  url: string,
  expected: string,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${String(response.status)}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`${url} has SHA-256 ${actual}, expected ${expected}`);
  }
  return bytes;
}
