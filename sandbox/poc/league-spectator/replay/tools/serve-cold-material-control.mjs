import { resolve, dirname, join } from "node:path";
import { realpath, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [rootArg, vendorArg, outputArg, portArg = "4264"] = process.argv.slice(2);
if (!rootArg || !vendorArg || !outputArg || !/^\d+$/.test(portArg))
  throw Error(
    "Usage: bun serve-cold-material-control.mjs <closed-public-root> <pinned-three-module> <fresh-proof-directory> [port]",
  );
const root = await realpath(resolve(rootArg)),
  vendor = resolve(vendorArg),
  output = resolve(outputArg),
  port = Number(portArg);
if (port < 1024 || port > 65535)
  throw Error("Explicit unprivileged loopback port required");
const inputs = {},
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  read = async (file) => {
    const bytes = await Bun.file(file).bytes();
    inputs[resolve(file)] = sha(bytes);
    return bytes;
  },
  entry = join(import.meta.dir, "cold-material-browser-control.mjs");
await captureDirectSourceInputs([entry, import.meta.path], read);
await read(vendor);
await read(join(dirname(vendor), "three.core.js"));
const built = await Bun.build({
  entrypoints: [entry],
  target: "browser",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "pinned-three",
      setup(build) {
        build.onResolve({ filter: /^three$/ }, () => ({ path: vendor }));
      },
    },
  ],
});
if (!built.success || built.outputs.length !== 1)
  throw new AggregateError(built.logs, "Cold component browser bundle failed");
await mkdir(output, { recursive: true });
if (await Bun.file(join(output, "server-inputs.json")).exists())
  throw Error("Fresh browser control output required");
const bundle = new Uint8Array(await built.outputs[0].arrayBuffer()),
  bootstrapFile = "latest-static-catalog/bootstrap.json",
  catalogFile = "latest-static-catalog/catalog.json",
  bootstrapBytes = await read(join(root, bootstrapFile)),
  bootstrap = JSON.parse(new TextDecoder().decode(bootstrapBytes)),
  catalogBytes = await read(join(root, catalogFile)),
  catalog = JSON.parse(new TextDecoder().decode(catalogBytes));
if (
  bootstrap.catalog.path !== catalogFile ||
  sha(catalogBytes) !== bootstrap.catalog.sha256
)
  throw Error("Selected catalog bootstrap differs");
const declarations = new Map(Object.entries(catalog.files));
const profileBytes = await read(join(root, bootstrap.profile.path));
if (sha(profileBytes) !== bootstrap.profile.sha256)
  throw Error("Selected immutable base profile differs");
declarations.set(bootstrap.profile.path, {
  sha256: bootstrap.profile.sha256,
  bytes: profileBytes.length,
});
declarations.set(bootstrapFile, {
  sha256: sha(bootstrapBytes),
  bytes: bootstrapBytes.length,
});
declarations.set(catalogFile, {
  sha256: sha(catalogBytes),
  bytes: catalogBytes.length,
});
const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Original material component control</title><link rel="stylesheet" href="/control.css"><body><main><h1>Original material component control</h1><p>Exact archived shaders and owned original textures. Explicit test quads; this is separate from replay simulation and native spectator admission.</p><p id="status" role="status">Loading validated source materials…</p><canvas aria-label="45 original materials on controlled unit quads"></canvas><ol id="materials"></ol></main><script type="module" src="/control.mjs"></script></body></html>',
  css =
    "body{background:#101720;color:#e8edf5;font:16px system-ui;margin:0;padding:24px}main{max-width:1080px;margin:auto}h1{font-size:24px}p{line-height:1.5}canvas{display:block;width:100%;aspect-ratio:9/5;border:1px solid #718299}ol{columns:3;font:12px monospace;overflow-wrap:anywhere;padding-left:24px}li{break-inside:avoid;margin:5px 0}";
const headers = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};
const consumed = {};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url),
      pathname = url.pathname;
    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405 });
    const fixed =
      pathname === "/"
        ? [html, "text/html"]
        : pathname === "/control.css"
          ? [css, "text/css"]
          : pathname === "/control.mjs"
            ? [bundle, "text/javascript"]
            : pathname === "/favicon.ico"
              ? [new Uint8Array(), "image/x-icon"]
              : null;
    if (fixed)
      return new Response(fixed[0], {
        headers: { ...headers, "Content-Type": fixed[1] },
      });
    if (pathname === "/proof.json") {
      for (const [file, digest] of Object.entries(inputs))
        if (sha(await Bun.file(file).bytes()) !== digest)
          throw Error(`Browser control input drift: ${file}`);
      return Response.json(
        {
          inputs,
          consumed,
          bundleSha256: sha(bundle),
          catalogSha256: sha(catalogBytes),
          sourceDrift: 0,
        },
        { headers },
      );
    }
    if (!pathname.startsWith("/assets/"))
      return new Response("Not found", { status: 404 });
    const relative = pathname.slice(8),
      ref = declarations.get(relative);
    if (
      !ref ||
      !/^[-A-Za-z0-9_./]+$/.test(relative) ||
      relative.split("/").some((p) => !p || p === "." || p === "..")
    )
      return new Response("Not found", { status: 404 });
    const file = await realpath(join(root, relative));
    if (!file.startsWith(root + (process.platform === "win32" ? "\\" : "/")))
      throw Error("Selected asset escapes declared root");
    const bytes = await Bun.file(file).bytes();
    if (bytes.length !== ref.bytes || sha(bytes) !== ref.sha256)
      throw Error(`Selected resource drift: ${relative}`);
    consumed[relative] = ref.sha256;
    const type = relative.endsWith(".json")
      ? "application/json"
      : /\.[cm]?js$/.test(relative)
        ? "text/javascript"
        : relative.endsWith(".png")
          ? "image/png"
          : "application/octet-stream";
    return new Response(bytes, {
      headers: { ...headers, "Content-Type": type },
    });
  },
});
await Bun.write(join(output, "control.mjs"), bundle);
await Bun.write(
  join(output, "server-inputs.json"),
  JSON.stringify({
    url: server.url.href,
    inputs,
    catalogSha256: sha(catalogBytes),
    bundleSha256: sha(bundle),
  }),
);
console.log(
  JSON.stringify({
    url: server.url.href,
    output,
    kind: "controlled-material-webgl-only",
    nativeSpectatorAdmitted: false,
  }),
);
