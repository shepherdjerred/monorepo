#!/usr/bin/env bun
// Fetches the built pokeemerald.wasm into packages/backend/assets/.
// The wasm builds from source (no copyrighted ROM), but building requires the
// GBA decomp toolchain; for now we vendor the published artifact. Pin a known
// URL and verify it is a real wasm module. Override with POKEEMERALD_WASM_URL.
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

mkdirSync(dirname(OUT), { recursive: true });
await Bun.write(OUT, bytes);
console.log(`wrote ${(bytes.length / 1048576).toFixed(1)} MiB -> ${OUT}`);
