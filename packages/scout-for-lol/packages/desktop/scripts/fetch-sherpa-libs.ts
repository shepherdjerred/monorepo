// Downloads the pinned sherpa-onnx static-library archives into
// target/sherpa-onnx-archives and checks each SHA-256 against
// sherpa-onnx-libs.json. sherpa-onnx-sys would otherwise download its native
// library at build time with no integrity check; release builds set
// SHERPA_ONNX_ARCHIVE_DIR to this directory so it copies the verified archive
// instead (see package-release.ts and the README's "Release builds").
//   bun scripts/fetch-sherpa-libs.ts [destination]
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pins: {
  version: string;
  baseUrl: string;
  archives: Record<string, string>;
} = JSON.parse(await readFile(join(root, "sherpa-onnx-libs.json"), "utf8"));
const destination =
  process.argv[2] ?? join(root, "target/sherpa-onnx-archives");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

await mkdir(destination, { recursive: true });
for (const [name, expected] of Object.entries(pins.archives)) {
  const path = join(destination, name);
  const cached = await readFile(path).catch(() => undefined);
  if (cached !== undefined && sha256(cached) === expected) {
    continue;
  }
  const url = `${pins.baseUrl}/${name}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${String(response.status)}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`${url} has SHA-256 ${actual}, expected ${expected}`);
  }
  await writeFile(`${path}.partial`, bytes);
  await rename(`${path}.partial`, path);
}
console.log(`sherpa-onnx ${pins.version} archives verified in ${destination}`);
