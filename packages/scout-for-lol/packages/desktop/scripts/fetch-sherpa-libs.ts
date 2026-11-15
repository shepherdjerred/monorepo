// Downloads the pinned sherpa-onnx static-library archives into
// target/sherpa-onnx-archives and checks each SHA-256 against
// sherpa-onnx-libs.json. sherpa-onnx-sys would otherwise download its native
// library at build time with no integrity check; release builds set
// SHERPA_ONNX_ARCHIVE_DIR to this directory so it copies the verified archive
// instead (see package-release.ts and the README's "Release builds").
//   bun scripts/fetch-sherpa-libs.ts [destination]
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { download, sha256 } from "./verified-download.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const pins: {
  version: string;
  baseUrl: string;
  archives: Record<string, string>;
} = JSON.parse(await readFile(join(root, "sherpa-onnx-libs.json"), "utf8"));
const destination =
  process.argv[2] ?? join(root, "target/sherpa-onnx-archives");

await mkdir(destination, { recursive: true });
for (const [name, expected] of Object.entries(pins.archives)) {
  const path = join(destination, name);
  const cached = await readFile(path).catch(() => undefined);
  if (cached !== undefined && sha256(cached) === expected) {
    continue;
  }
  const bytes = await download(`${pins.baseUrl}/${name}`, expected);
  await writeFile(`${path}.partial`, bytes);
  await rename(`${path}.partial`, path);
}
console.log(`sherpa-onnx ${pins.version} archives verified in ${destination}`);
