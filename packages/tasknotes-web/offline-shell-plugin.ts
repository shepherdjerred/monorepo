import { createHash } from "node:crypto";
import type { Plugin } from "vite";

function workerSource(version: string, shell: string[]): string {
  return [
    'const prefix = "facet-shell-";',
    "const cacheName = prefix + " + JSON.stringify(version) + ";",
    "const shell = " + JSON.stringify(shell) + ";",
    "",
    "self.addEventListener('install', (event) => {",
    "  event.waitUntil((async () => {",
    "    const cache = await caches.open(cacheName);",
    "    await cache.addAll(shell);",
    "  })());",
    "});",
    "",
    "self.addEventListener('activate', (event) => {",
    "  event.waitUntil((async () => {",
    "    const keys = await caches.keys();",
    "    await Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== cacheName).map((key) => caches.delete(key)));",
    "    await self.clients.claim();",
    "  })());",
    "});",
    "",
    "async function readShell(pathname) {",
    "  const cache = await caches.open(cacheName);",
    "  return await cache.match(pathname);",
    "}",
    "",
    "async function navigate(request) {",
    "  try {",
    "    return await fetch(request);",
    "  } catch {",
    "    return (await readShell('/')) ?? Response.error();",
    "  }",
    "}",
    "",
    "self.addEventListener('fetch', (event) => {",
    "  const { request } = event;",
    "  if (request.method !== 'GET' || request.headers.has('authorization')) return;",
    "  const url = new URL(request.url);",
    "  if (url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/metrics')) return;",
    "  if (request.mode === 'navigate') {",
    "    event.respondWith(navigate(request));",
    "    return;",
    "  }",
    "  if (shell.includes(url.pathname)) {",
    "    event.respondWith((async () => (await readShell(url.pathname)) ?? await fetch(request))());",
    "  }",
    "});",
    "",
  ].join("\n");
}

export function offlineShellPlugin(): Plugin {
  return {
    name: "facet-offline-shell",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_output, bundle) {
        const html = bundle["index.html"];
        if (html?.type !== "asset")
          throw new Error("Facet offline shell requires index.html.");
        const assets = Object.keys(bundle)
          .filter(
            (path) => path.startsWith("assets/") && !path.endsWith(".map"),
          )
          .sort();
        const hash = createHash("sha256")
          .update(html.source)
          .update(assets.join("\n"));
        const version = hash.digest("hex").slice(0, 14);
        this.emitFile({
          type: "asset",
          fileName: "facet-sw.js",
          source: workerSource(version, [
            "/",
            ...assets.map((path) => "/" + path),
          ]),
        });
      },
    },
  };
}
