// Read back the sampler package and modules served by the private preview.
import { resolve } from "node:path";
const [cachePath, baseUrl] = process.argv.slice(2);
if (!cachePath || !baseUrl)
  throw Error(
    "Usage: bun publish-native-animation-http.mjs <cache> <preview-base-url>",
  );
const base = new URL(baseUrl),
  cache = resolve(cachePath),
  inputs = {},
  observations = [];
if (
  !["http:", "https:"].includes(base.protocol) ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
)
  throw Error(
    "Explicit preview HTTP origin without credentials/query required",
  );
const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const resources = [
  [
    "/assets/latest-native-animation-resources/manifest.json",
    `${cache}/public/latest-native-animation-resources/manifest.json`,
  ],
  [
    "/assets/latest-native-animation-resources/static.bin",
    `${cache}/public/latest-native-animation-resources/static.bin`,
  ],
  ...[
    "latest-native-animation-resources.mjs",
    "latest-native-animation-catalog.mjs",
    "latest-vfx-spawn.mjs",
    "native-decoder.mjs",
    "structural-comparison.mjs",
  ].map((name) => [`/${name}`, `${import.meta.dir}/../${name}`]),
];
for (const [pathname, path] of resources) {
  const local = new Uint8Array(await Bun.file(path).arrayBuffer()),
    expected = hash(local);
  inputs[resolve(path)] = expected;
  const url = new URL(pathname, base),
    response = await fetch(url),
    body = new Uint8Array(await response.arrayBuffer());
  if (response.status !== 200 || hash(body) !== expected)
    throw Error(`Served native animation artifact differs: ${pathname}`);
  const mime = response.headers.get("content-type") ?? "";
  if (pathname.endsWith(".mjs") && !/javascript/.test(mime))
    throw Error(`Sampler module MIME differs: ${pathname}`);
  observations.push({
    url: url.href,
    status: response.status,
    bytes: body.length,
    sha256: expected,
    contentType: mime,
  });
}
const result = {
  schema: 1,
  kind: "native-animation-private-preview-readback",
  inputs,
  observations,
  sourceSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  scope: {
    byteForByteHttpDelivery: true,
    browserExecution: false,
    mainViewerExpanded: false,
  },
};
const target = `${cache}/research/native-animation-http-readback-${base.protocol === "https:" ? "https" : "http"}.json`;
await Bun.write(target, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: target,
    resources: observations.length,
    allBytesMatch: true,
  }),
);
