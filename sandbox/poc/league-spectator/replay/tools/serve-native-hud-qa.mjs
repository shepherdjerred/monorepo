import { resolve } from "node:path";
import { createHash } from "node:crypto";

const [rootArgument, portArgument = "4250"] = process.argv.slice(2);
if (!rootArgument || !/^\d+$/.test(portArgument))
  throw Error("Usage: serve-native-hud-qa.mjs <closed-qa-package-root> [port]");
const root = resolve(rootArgument),
  port = Number(portArgument);
if (port < 1024 || port > 65535)
  throw Error("Explicit unprivileged QA port required");
const moduleRoot = new URL("../", import.meta.url),
  files = new Map([
    [
      "/",
      { file: new URL("native-hud-qa.html", moduleRoot), type: "text/html" },
    ],
    [
      "/qa.css",
      { file: new URL("native-hud-qa.css", moduleRoot), type: "text/css" },
    ],
    [
      "/qa.mjs",
      {
        file: new URL("native-hud-qa.mjs", moduleRoot),
        type: "text/javascript",
      },
    ],
    [
      "/latest-native-hud-compositor.mjs",
      {
        file: new URL("latest-native-hud-compositor.mjs", moduleRoot),
        type: "text/javascript",
      },
    ],
    [
      "/manifest.json",
      { file: resolve(root, "manifest.json"), type: "application/json" },
    ],
  ]),
  manifest = await Bun.file(resolve(root, "manifest.json")).json();
if (manifest.kind !== "original-native-hud-static-qa")
  throw Error("Closed native HUD QA package required");
for (const asset of [...Object.values(manifest.textures), ...manifest.fonts]) {
  if (!/^\/assets\/[a-f0-9]{64}\.(png|otf|ttf)$/.test(asset.url))
    throw Error("Unconfined native HUD asset URL");
  const file = resolve(root, asset.url.slice(1)),
    bytes = await Bun.file(file).bytes();
  if (
    bytes.length !== asset.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  )
    throw Error("Required original HUD QA asset is missing or changed");
  files.set(asset.url, {
    file,
    type: asset.url.endsWith(".png")
      ? "image/png"
      : asset.url.endsWith(".otf")
        ? "font/otf"
        : "font/ttf",
  });
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const file = files.get(new URL(request.url).pathname);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(file.file), {
      headers: {
        "Content-Type": file.type,
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      },
    });
  },
});
console.log(
  JSON.stringify({
    url: server.url.href,
    primitives: manifest.primitives.length,
    fonts: manifest.fonts.length,
    scope:
      "Static original HUD primitive QA; explicit controlled states, no live native controller binding",
  }),
);
