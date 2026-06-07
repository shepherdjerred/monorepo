#!/usr/bin/env bun
// Fetches the built pokeemerald.wasm into packages/backend/assets/.
// The wasm builds from source (no copyrighted ROM), but building requires the
// GBA decomp toolchain; for now we vendor the published artifact. Pin a known
// URL and verify it is a real wasm module. Override with POKEEMERALD_WASM_URL.
//
// Integrity: the SHA-256 of the vendored blob is committed alongside it in
// `pokeemerald.wasm.sha256`. Every download is verified against that pin (or
// POKEEMERALD_WASM_SHA256 if set), so a tampered/replaced upstream artifact is
// rejected instead of silently vendored. Accepting a genuinely new upstream
// build requires ALLOW_WASM_UPDATE=1 — the monthly Temporal refresh sets this,
// rewrites the sidecar, and lands the new blob in a human-reviewed PR.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const WASM_URL =
  Bun.env.POKEEMERALD_WASM_URL ??
  "https://pokeemerald.com/build/wasm/pokeemerald.wasm";
const OUT = join(
  import.meta.dir,
  "..",
  "packages",
  "backend",
  "assets",
  "pokeemerald.wasm",
);
const SHA_OUT = `${OUT}.sha256`;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

if (existsSync(OUT) && !Bun.env.FORCE) {
  console.log(
    `pokeemerald.wasm already present at ${OUT} (set FORCE=1 to refetch)`,
  );
  process.exit(0);
}

console.log(`fetching ${WASM_URL}`);
const res = await fetch(WASM_URL);
if (!res.ok) {
  throw new Error(`failed to fetch wasm: HTTP ${String(res.status)}`);
}
const bytes = new Uint8Array(await res.arrayBuffer());

// Verify the wasm magic number (\0asm) so we fail fast on an HTML error page.
if (
  !(
    bytes[0] === 0x00 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x73 &&
    bytes[3] === 0x6d
  )
) {
  throw new Error("downloaded file is not a wasm module (bad magic number)");
}

// Verify the SHA-256 against the committed pin (or POKEEMERALD_WASM_SHA256), so
// a tampered/replaced artifact never lands silently.
const sha256 = toHex(await crypto.subtle.digest("SHA-256", bytes));
console.log(`sha256: ${sha256}`);

const expected =
  Bun.env.POKEEMERALD_WASM_SHA256 ??
  (existsSync(SHA_OUT) ? (await Bun.file(SHA_OUT).text()).trim() : undefined);

if (expected !== undefined && sha256 !== expected) {
  if (!Bun.env.ALLOW_WASM_UPDATE) {
    throw new Error(
      `wasm sha256 ${sha256} does not match expected ${expected}. ` +
        `Set ALLOW_WASM_UPDATE=1 to accept a new upstream build (the sidecar is ` +
        `rewritten and the change must be reviewed in the resulting PR).`,
    );
  }
  console.warn(
    `accepting new wasm build: ${expected} -> ${sha256} (ALLOW_WASM_UPDATE set)`,
  );
}

mkdirSync(dirname(OUT), { recursive: true });
await Bun.write(OUT, bytes);
await Bun.write(SHA_OUT, `${sha256}\n`);
console.log(`wrote ${(bytes.length / 1048576).toFixed(1)} MiB -> ${OUT}`);
