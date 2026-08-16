import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { z } from "zod";

const packageRoot = resolve(import.meta.dir, "..");
const assetsRoot = resolve(packageRoot, "src/data-dragon/assets");
const imageRoot = resolve(assetsRoot, "img");
const manifestPath = resolve(assetsRoot, "manifest.json");
const versionSchema = z.object({ version: z.string().min(1) });
const version = versionSchema.parse(
  await Bun.file(resolve(assetsRoot, "version.json")).json(),
).version;

type Dimensions = { width: number; height: number };

function pngDimensions(bytes: Uint8Array): Dimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegDimensions(bytes: Uint8Array): Dimensions {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) break;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    const high = bytes[offset + 2];
    const low = bytes[offset + 3];
    if (high === undefined || low === undefined) break;
    offset += 2 + high * 256 + low;
  }
  throw new Error("JPEG is missing a supported frame header");
}

function sha256(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

const paths: string[] = [];
for (const extension of ["png", "jpg"]) {
  const glob = new Bun.Glob(`**/*.${extension}`);
  for await (const path of glob.scan({ cwd: imageRoot })) paths.push(path);
}

const assets = await Promise.all(
  paths.toSorted().map(async (relativeImagePath) => {
    const [kind, filename] = relativeImagePath.split("/");
    if (kind === undefined || filename === undefined) {
      throw new Error(`Invalid game asset path: ${relativeImagePath}`);
    }
    if (
      kind !== "champion" &&
      kind !== "champion-loading" &&
      kind !== "champion-splash" &&
      kind !== "item" &&
      kind !== "rune" &&
      kind !== "spell" &&
      kind !== "augment" &&
      kind !== "lane" &&
      kind !== "background"
    ) {
      throw new Error(`Unknown game asset kind: ${kind}`);
    }
    const bytes = new Uint8Array(
      await Bun.file(resolve(imageRoot, relativeImagePath)).arrayBuffer(),
    );
    const isPng = filename.endsWith(".png");
    const dimensions = isPng ? pngDimensions(bytes) : jpegDimensions(bytes);
    return {
      kind,
      canonicalId: filename.slice(0, filename.lastIndexOf(".")),
      mimeType: isPng ? "image/png" : "image/jpeg",
      ...dimensions,
      relativePath: `img/${relativeImagePath}`,
      sha256: sha256(bytes),
    };
  }),
);

const manifest = { version: 1, sourceVersion: version, assets };
const serialized = `${JSON.stringify(manifest, undefined, 2)}\n`;
if (Bun.argv.includes("--write")) {
  await Bun.write(manifestPath, serialized);
  console.log(
    `Wrote ${assets.length} Data Dragon asset records for ${version}`,
  );
} else {
  assert.equal(
    await Bun.file(manifestPath).text(),
    serialized,
    "Game asset manifest drifted; run bun run generate:asset-manifest",
  );
  console.log(
    `Verified ${assets.length} Data Dragon asset records for ${version}`,
  );
}
