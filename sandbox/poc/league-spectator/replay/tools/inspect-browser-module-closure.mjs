// Execute the browser module resolver's static import closure over the actual
// served bytes. This is a module-loading control, not browser execution.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
const [cacheArg, baseArg] = process.argv.slice(2);
if (!cacheArg || !baseArg || process.argv.length !== 4)
  throw Error("Usage: inspect-browser-module-closure.mjs <cache> <server-url>");
const cache = resolve(cacheArg),
  source = resolve(import.meta.dir, ".."),
  base = new URL(baseArg);
if (
  base.pathname !== "/" ||
  base.search ||
  base.hash ||
  base.username ||
  base.password
)
  throw Error("Explicit server origin required");
const inputs = {},
  rows = [],
  pending = [
    "/latest-viewer.mjs",
    "/structural-check-worker.mjs",
    "/latest-direct-effect-worker.mjs",
    "/latest-targeted-missile-worker.mjs",
  ],
  seen = new Set(),
  parser = new Bun.Transpiler({ loader: "js" });
async function raw(path) {
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
await raw(import.meta.path);
const htmlBytes = await raw(`${source}/latest.html`),
  html = new TextDecoder().decode(htmlBytes),
  match = html.match(/<script\s+type="importmap">\s*([\s\S]*?)<\/script>/);
if (!match) throw Error("Actual viewer import map required");
const imports = JSON.parse(match[1]).imports;
while (pending.length) {
  const path = pending.pop();
  if (seen.has(path)) continue;
  seen.add(path);
  const local = resolve(
    path.startsWith("/assets/") ? `${cache}/public` : source,
    path.replace(/^\/assets\//, "").replace(/^\//, ""),
  );
  const expected = await raw(local),
    response = await fetch(new URL(path, base)),
    actual = await response.bytes();
  if (
    response.status !== 200 ||
    (await sha256(actual)) !== (await sha256(expected))
  )
    throw Error(
      `Served module absent or different: ${path} HTTP ${response.status}`,
    );
  const children = [],
    dynamicImports = [];
  for (const entry of parser.scanImports(
    new TextDecoder("utf-8", { fatal: true }).decode(actual),
  )) {
    if (entry.kind !== "import-statement") {
      dynamicImports.push(entry);
      continue;
    }
    const specifier = entry.path;
    const mapped = imports[specifier] ?? specifier;
    if (!mapped.startsWith(".") && !mapped.startsWith("/"))
      throw Error(`Unmapped browser module import: ${path} → ${specifier}`);
    const child = new URL(mapped, new URL(path, base));
    if (child.origin !== base.origin || child.search || child.hash)
      throw Error("Unexpected external or decorated browser module import");
    children.push({ kind: entry.kind, specifier, path: child.pathname });
    pending.push(child.pathname);
  }
  rows.push({
    path,
    sha256: await sha256(actual),
    bytes: actual.length,
    status: response.status,
    imports: children,
    dynamicImportsNotExecuted: dynamicImports,
  });
}
rows.sort((a, b) => a.path.localeCompare(b.path));
const output = `${cache}/research/browser-module-closure-control.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "served-browser-static-module-closure-control",
      inputs,
      serverOrigin: base.origin,
      rows,
      counts: {
        modules: rows.length,
        bytes: rows.reduce((n, r) => n + r.bytes, 0),
        assetModules: rows.filter((r) => r.path.startsWith("/assets/")).length,
      },
      scope: {
        allStaticImportsResolvedAndHttpBytesExact: true,
        browserExecuted: false,
        dynamicComputedImportsNotEnumerated: true,
        assetCatalogAndFixedProviderFetchesSeparate: true,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    modules: rows.length,
    assetModules: rows
      .filter((r) => r.path.startsWith("/assets/"))
      .map((r) => r.path),
  }),
);
