// Actual same-origin static item URLs; no browser/HUD rendering claim.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import {
  createLatestItemAssets,
  ITEM_ASSETS_SHA,
} from "../latest-item-assets.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [cacheArg, originArg, reportArg] = process.argv.slice(2);
if (!cacheArg || !originArg || !reportArg || process.argv.length !== 5)
  throw Error(
    "Usage: inspect-selected-item-assets.mjs <cache> <origin> <ordinary-report.json>",
  );
const cache = resolve(cacheArg),
  origin = new URL(originArg),
  inputs = {},
  fetched = new Map();
if (
  !["127.0.0.1", "localhost"].includes(origin.hostname) ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw Error("Explicit loopback static origin required");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Item control input changed");
  inputs[path] = hash;
  return bytes;
}
const parse = (b) => JSON.parse(new TextDecoder().decode(b));
await captureDirectSourceInputs([import.meta.path], raw);
const report = parse(await raw(reportArg));
async function remote(path) {
  const response = await fetch(new URL(`/assets/${path}`, origin));
  if (response.status !== 200)
    throw Error(`Selected item asset HTTP${response.status}: ${path}`);
  const bytes = new Uint8Array(await response.arrayBuffer()),
    hash = await sha256(bytes);
  if (hash !== (await sha256(await raw(`${cache}/public/${path}`))))
    throw Error("Served selected item/root bytes differ: " + path);
  fetched.set(path, {
    sha256: hash,
    bytes: bytes.length,
    httpStatus: response.status,
  });
  return bytes;
}
const selected = await loadLatestStaticCatalogSelection({ load: remote }),
  packagePath = "latest-items/package.json",
  bytes = await selected.read(packagePath),
  metadata = parse(bytes);
if ((await sha256(bytes)) !== ITEM_ASSETS_SHA)
  throw Error("Fixed installed item package required");
const items = await createLatestItemAssets(report, bytes),
  icons = new Map();
for (const item of Object.values(metadata.items)) {
  if (!/^icons\/[a-f0-9]{64}\.png$/.test(item.icon))
    throw Error("Bounded installed icon path required");
  const path = `latest-items/${item.icon}`,
    prior = icons.get(path);
  if (prior && prior !== item.iconSha256)
    throw Error("Ambiguous installed icon");
  icons.set(path, item.iconSha256);
}
const entries = [...icons];
for (let start = 0; start < entries.length; start += 8)
  await Promise.all(
    entries.slice(start, start + 8).map(async ([path, hash]) => {
      if ((await sha256(await selected.read(path))) !== hash)
        throw Error("Declared item PNG differs");
    }),
  );
const ids = [
  ...new Set(
    report.inventoryEvents.flatMap((e) =>
      e.entries.filter((f) => f.count > 0 && f.itemId).map((f) => f.itemId),
    ),
  ),
].sort((a, b) => a - b);
for (const id of ids) items.get(id);
const local = parse(
  await raw(`${cache}/public/latest-static-catalog/catalog.json`),
);
if (
  !sameDirectCompiledData(local.roles, selected.describe().roles) ||
  !sameDirectCompiledData(local.files, selected.describe().files)
)
  throw Error("Served selected root inventory differs from local publication");
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Final item URL control input changed");
const result = {
  schema: 1,
  kind: "verified-selected-static-item-urls",
  inputs,
  origin: origin.href,
  catalog: selected.describe(),
  replaySha256: report.replaySha256,
  itemPackageSha256: ITEM_ASSETS_SHA,
  items: Object.keys(metadata.items).length,
  icons: icons.size,
  decodedEquippedIds: ids,
  http: [...fetched].map(([path, entry]) => ({ path, ...entry })),
  scope: {
    allDeclaredItemIconsHttp200: true,
    decodedEquippedItemsResolved: true,
    pixelRendering: false,
    ordinaryBrowserPlayback: false,
  },
};
await Bun.write(
  `${cache}/research/selected-item-http-control.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    items: result.items,
    icons: result.icons,
    equippedIds: ids.length,
    http200: result.http.length,
  }),
);
