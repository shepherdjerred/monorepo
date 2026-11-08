// Fetch one exact release executable for offline packet-function preparation.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../structural-comparison.mjs";

const [rmanPath, vendorPath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun tools/fetch-macos-decoder.mjs <pinned-rman.js> <fzstd.mjs> <output-dir>",
  );
// shyunku-libraries/lol-exe-downloader revision 29cc02033e9710b281ddaf85c240dfb63da1026b.
if (
  (await sha256(await Bun.file(rmanPath).arrayBuffer())) !==
  "61b23c599356a57e23e04083cc87901ec52b367f45abed491ac5a20783b6e1c9"
)
  throw Error("RMAN parser revision mismatch");
const { parseRman } = await import(pathToFileURL(resolve(rmanPath)));
const { decompress } = await import(pathToFileURL(resolve(vendorPath)));
const manifestUrl =
  "https://lol.secure.dyn.riotcdn.net/channels/public/releases/B0DE7A4FF23DB6B4.manifest";
const response = await fetch(manifestUrl);
if (response.status !== 200) throw Error(`Manifest HTTP ${response.status}`);
const manifestBytes = new Uint8Array(await response.arrayBuffer());
const manifestSha256 = await sha256(manifestBytes);
if (
  manifestSha256 !==
  "49ef56e82059d2bd30fe0fc69eb595ede117c387efacf7a1a3773bd8990c4f8e"
)
  throw Error("Exact release manifest hash mismatch");
const manifest = parseRman(manifestBytes);
const matches = manifest.files.filter(
  (file) => file.name === "LeagueofLegends.app/Contents/MacOS/LeagueofLegends",
);
if (matches.length !== 1 || matches[0].size !== 75087648)
  throw Error("Unexpected release executable entry");
const file = matches[0];
const chunks = await Promise.all(
  file.chunks.map(async (chunk) => {
    const id = chunk.bundleId.toString(16).toUpperCase().padStart(16, "0");
    const end = chunk.offset + chunk.compressedSize - 1;
    const result = await fetch(
      `https://lol.dyn.riotcdn.net/channels/public/bundles/${id}.bundle`,
      {
        headers: { Range: `bytes=${chunk.offset}-${end}` },
      },
    );
    if (
      result.status !== 206 ||
      !result.headers
        .get("content-range")
        ?.startsWith(`bytes ${chunk.offset}-${end}/`)
    )
      throw Error(`Bundle ${id}: invalid byte-range response`);
    const compressed = new Uint8Array(await result.arrayBuffer());
    if (compressed.length !== chunk.compressedSize)
      throw Error(`Bundle ${id}: compressed size mismatch`);
    const bytes = decompress(compressed);
    if (bytes.length !== chunk.uncompressedSize)
      throw Error(`Bundle ${id}: expanded size mismatch`);
    return bytes;
  }),
);
const binary = Buffer.concat(chunks);
const binarySha256 = await sha256(binary);
if (
  binary.length !== file.size ||
  binarySha256 !==
    "0414ccc2ddfd3ba209c75d9c8f6ee6611ff1de11426afdf54007df12df219fab"
)
  throw Error("Exact release executable hash mismatch");
await Bun.write(resolve(outputPath, "macos.manifest"), manifestBytes);
await Bun.write(resolve(outputPath, "LeagueofLegends-macos"), binary);
const provenance = {
  build: "16.21.829.8620",
  manifestUrl,
  manifestSha256,
  binarySha256,
  bytes: binary.length,
};
await Bun.write(
  resolve(outputPath, "macos-source.json"),
  JSON.stringify(provenance, null, 2),
);
console.log(JSON.stringify(provenance));
