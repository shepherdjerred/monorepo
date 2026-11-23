import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openReplay } from "../transport.mjs";
import { buildCombatTimelineWorker } from "./build-combat-worker.ts";

const [
  assetArgument,
  replayArgument,
  cssArgument,
  scoutAssetsArgument,
  portArgument = "4182",
  secondsArgument,
  nativeControlsArgument,
] = process.argv.slice(2);
if (
  !assetArgument ||
  !replayArgument ||
  !cssArgument ||
  !scoutAssetsArgument ||
  process.argv.length > 9
)
  throw new Error(
    "Usage: bun tools/serve-scout-demo.ts <league-asset-root> <replay.rofl> <compiled-Scout-css-file> <Scout-assets-root> [port] [decoded-seconds|combat] [closed-native-controls-manifest]",
  );
const combat = secondsArgument === "combat";
if (combat && nativeControlsArgument !== undefined)
  throw new Error("Combat timeline mode does not accept native control assets");
const port = Number(portArgument),
  requestedSeconds =
    secondsArgument === undefined || combat ? null : Number(secondsArgument);
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  (requestedSeconds !== null &&
    (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0))
)
  throw new Error("A valid port and positive decoded duration are required");
const sourceRoot = await realpath(
  fileURLToPath(new URL("../", import.meta.url)),
);
const repositoryRoot = path.resolve(sourceRoot, "../../../..");
const appRoot = path.join(
  repositoryRoot,
  "packages/scout-for-lol/packages/app",
);
const assets = await realpath(path.resolve(assetArgument));
const replayFile = Bun.file(await realpath(path.resolve(replayArgument)));
const cssPath = await realpath(path.resolve(cssArgument));
const cssFile = Bun.file(cssPath);
const scoutAssets = await realpath(path.resolve(scoutAssetsArgument));
const scoutAssetPrefix = "/assets/scout/";
const requiredAssets = [
  ...(await cssFile.text()).matchAll(
    /url\(["']?(\/assets\/scout\/[^)"']+)["']?\)/g,
  ),
];
if (requiredAssets.length === 0)
  throw new Error(
    "The selected stylesheet has no Scout assets; provide the compiled app stylesheet.",
  );
for (const match of requiredAssets) {
  const url = match[1];
  if (!url) throw new Error("A declared Scout asset URL is missing");
  const relative = decodeURIComponent(url.slice(scoutAssetPrefix.length));
  const candidate = path.resolve(scoutAssets, relative);
  if (
    !candidate.startsWith(scoutAssets + path.sep) ||
    !(await Bun.file(candidate).exists())
  )
    throw new Error(
      `Required Scout asset is missing from the declared root: ${relative}`,
    );
  const metadata = await stat(candidate);
  if (!metadata.isFile() || metadata.size === 0)
    throw new Error(`Required Scout asset is empty or not a file: ${relative}`);
  if (!(await realpath(candidate)).startsWith(scoutAssets + path.sep))
    throw new Error(
      `Required Scout asset escapes the declared root: ${relative}`,
    );
}
const replayBytes = await replayFile.arrayBuffer();
const replay = openReplay(replayBytes);
if (
  replay.duration <= 0 ||
  (requestedSeconds !== null && requestedSeconds > replay.duration)
)
  throw new Error(
    "The decoded window must fit within the original replay duration",
  );
if (
  combat
    ? replay.protocol !== "8bbfcd5af2bc92db" ||
      !["16.23.839.9929", "16.23.840.6595"].includes(replay.build)
    : replay.build !== "16.21.829.8620" ||
      replay.protocol !== "20e09df23c66b85e"
)
  throw new Error(
    combat
      ? "The local combat timeline requires an observed 16.23 replay"
      : "The local research renderer admits only the exact 16.21 build/protocol",
  );
const sha256 = (bytes: ArrayBuffer) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const bootstrap = Bun.file(
  path.join(assets, "latest-static-catalog/bootstrap.json"),
);
const bootstrapBytes = combat ? null : await bootstrap.arrayBuffer();
const nativeControlsPath =
  nativeControlsArgument === undefined
    ? null
    : await realpath(path.resolve(nativeControlsArgument));
const nativeControlsFile =
  nativeControlsPath === null ? null : Bun.file(nativeControlsPath);
const nativeControlsBytes =
  nativeControlsFile === null ? null : await nativeControlsFile.arrayBuffer();
const nativeControlAssets = new Map<string, string>();
if (nativeControlsPath !== null && nativeControlsBytes !== null) {
  const manifest = JSON.parse(
    new TextDecoder().decode(nativeControlsBytes),
  ) as {
    kind: string;
    build: string;
    protocol: string;
    art: {
      textures: Record<string, { url: string; bytes: number; sha256: string }>;
    };
  };
  if (
    nativeControlsBytes.byteLength > 2 * 1024 * 1024 ||
    manifest.kind !== "original-native-replay-controls-bridge" ||
    manifest.build !== replay.build ||
    manifest.protocol !== replay.protocol
  )
    throw new Error(
      "An exact-build bounded closed native control manifest is required",
    );
  const assetRoot = path.dirname(nativeControlsPath);
  for (const asset of Object.values(manifest.art.textures)) {
    if (!/^\/assets\/[a-f0-9]{64}\.png$/.test(asset.url))
      throw new Error("Unconfined original native control texture URL");
    if (
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      asset.bytes > 64 * 1024 * 1024
    )
      throw new Error("Bounded original native control texture required");
    const file = await realpath(path.resolve(assetRoot, asset.url.slice(1)));
    if (!file.startsWith(assetRoot + path.sep))
      throw new Error(
        "Original native control texture escapes its package root",
      );
    if ((await stat(file)).size !== asset.bytes)
      throw new Error("Original native control texture length changed");
    const bytes = await Bun.file(file).arrayBuffer();
    if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256)
      throw new Error("Original native control texture is missing or changed");
    nativeControlAssets.set(asset.url, file);
  }
}
const replayResource = {
  url: "/demo/replay.rofl",
  bytes: replayBytes.byteLength,
  sha256: sha256(replayBytes),
};
const config =
  bootstrapBytes === null
    ? null
    : {
        schema: 1,
        build: replay.build,
        protocol: replay.protocol,
        durationSeconds: replay.duration,
        decodedSeconds: requestedSeconds ?? Math.min(120, replay.duration),
        assetBase: "/assets/",
        staticRootSha256: sha256(bootstrapBytes),
        ...(nativeControlsBytes === null
          ? {}
          : {
              nativeControls: {
                url: "/demo/native-controls.json",
                bytes: nativeControlsBytes.byteLength,
                sha256: sha256(nativeControlsBytes),
              },
            }),
        replay: replayResource,
      };

const result = await Bun.build({
  entrypoints: [
    path.join(sourceRoot, combat ? "scout-combat-demo.tsx" : "scout-demo.tsx"),
  ],
  target: "browser",
  format: "esm",
  minify: false,
  plugins: [
    {
      name: "scout-demo-workspace-dependencies",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(?:react(?:\/.*)?|react-dom(?:\/.*)?|zod(?:\/.*)?|@scout-for-lol\/.*)$/,
          },
          (args) => ({ path: Bun.resolveSync(args.path, appRoot) }),
        );
      },
    },
  ],
});
if (!result.success || result.outputs.length !== 1)
  throw new AggregateError(
    result.logs,
    "Scout replay demo browser bundle failed",
  );
const script = result.outputs[0];
if (!script) throw new Error("Scout replay demo bundle is missing");
const sharedTransportPath = path.join(
  repositoryRoot,
  "packages/scout-for-lol/packages/domain/src/artifacts/replay-transport.mjs",
);
const sharedTransportRoute =
  "/packages/scout-for-lol/packages/domain/src/artifacts/replay-transport.mjs";
const combatWorker = combat
  ? await buildCombatTimelineWorker(sourceRoot)
  : null;
const observationsRoute =
  "/packages/scout-for-lol/packages/replay/src/observations/";
const observationsRoot = path.join(
  repositoryRoot,
  "packages/scout-for-lol/packages/replay/src/observations",
);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scout · Local replay research</title><link rel="stylesheet" href="/scout-demo.css">${nativeControlsFile === null ? "" : '<link rel="stylesheet" href="/native-replay-controls.css">'}<script type="importmap">{"imports":{"three":"/assets/vendor/three.module.js"}}</script><style>body{margin:0;background:var(--scout-color-canvas,#09131d);color:var(--scout-color-text,#dae6ef);font-family:var(--scout-font-body,system-ui)}</style></head><body><div id="root"></div><script type="module" src="/scout-demo.js"></script></body></html>`;

async function confinedFile(root: string, relative: string): Promise<Response> {
  const candidate = path.resolve(root, relative);
  if (!candidate.startsWith(root + path.sep))
    return new Response("Forbidden", { status: 403 });
  const file = Bun.file(candidate);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  const actual = await realpath(candidate);
  const actualRoot = await realpath(root);
  if (!actual.startsWith(actualRoot + path.sep))
    return new Response("Forbidden", { status: 403 });
  return new Response(file, {
    headers: {
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      ...(actual.endsWith(".mjs") ? { "Content-Type": "text/javascript" } : {}),
    },
  });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    const url = new URL(request.url);
    if (url.pathname === "/")
      return new Response(html, {
        headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
      });
    if (url.pathname === "/scout-demo.js")
      return new Response(script, {
        headers: {
          "Content-Type": "text/javascript",
          "Cache-Control": "no-cache",
        },
      });
    if (url.pathname === "/scout-demo.css")
      return new Response(cssFile, {
        headers: { "Content-Type": "text/css", "Cache-Control": "no-cache" },
      });
    if (url.pathname === "/demo/config.json" && config !== null)
      return Response.json(config, {
        headers: { "Cache-Control": "no-store" },
      });
    if (
      url.pathname === "/demo/native-controls.json" &&
      nativeControlsBytes !== null
    )
      return new Response(nativeControlsBytes, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      });
    if (
      url.pathname === "/native-replay-controls.css" &&
      nativeControlsBytes !== null
    )
      return new Response(
        Bun.file(path.join(sourceRoot, "native-replay-controls.css")),
        {
          headers: { "Content-Type": "text/css", "Cache-Control": "no-cache" },
        },
      );
    const nativeControlAsset = nativeControlAssets.get(url.pathname);
    if (nativeControlAsset !== undefined)
      return new Response(Bun.file(nativeControlAsset), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (
      url.pathname === "/demo/replay.rofl" ||
      (combat && url.pathname === "/research-latest.rofl")
    )
      return new Response(combat ? replayBytes : replayFile, {
        headers: {
          "Content-Type": "application/vnd.riot.rofl",
          "Content-Length": String(replayResource.bytes),
          ETag: `"${replayResource.sha256}"`,
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (url.pathname === sharedTransportRoute)
      return new Response(Bun.file(sharedTransportPath), {
        headers: { "Content-Type": "text/javascript" },
      });
    if (
      url.pathname === "/research/combat-timeline-worker.mjs" &&
      combatWorker !== null
    )
      return new Response(combatWorker, {
        headers: {
          "Content-Type": "text/javascript",
          "Cache-Control": "no-cache",
        },
      });
    if (url.pathname.startsWith(observationsRoute)) {
      const name = url.pathname.slice(observationsRoute.length);
      if (!/^[a-z-]+\.mjs$/.test(name))
        return new Response("Forbidden", { status: 403 });
      return confinedFile(observationsRoot, name);
    }
    let relative: string;
    try {
      relative = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad path", { status: 400 });
    }
    if (relative.startsWith("/assets/scout/"))
      return confinedFile(scoutAssets, relative.slice("/assets/scout/".length));
    if (relative.startsWith("/assets/"))
      return confinedFile(assets, relative.slice("/assets/".length));
    if (
      relative.startsWith("/research/") &&
      relative.endsWith(".mjs") &&
      !relative.endsWith(".test.mjs")
    )
      return confinedFile(sourceRoot, relative.slice("/research/".length));
    return new Response("Not found", { status: 404 });
  },
});
console.log(
  `Scout ${combat ? "combat timeline" : "partial replay"} demo: ${server.url}`,
);
