import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { PublicMediaSchema } from "#protocol/media.ts";
import { escapeXml } from "#protocol/media-overlay.ts";

/** Serves only explicit rendered media and the docs component; private run data stays private. */
export async function serveReview(directory: string) {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const bundle = await Bun.build({
    entrypoints: [path.join(root, "packages/ts-mc-docs/src/media.ts")],
    target: "browser",
    minify: true,
  });
  if (!bundle.success)
    throw new AggregateError(
      bundle.logs,
      "Could not build the docs media component",
    );
  const script = bundle.outputs[0];
  if (script === undefined) throw new Error("Missing media component bundle");
  const entries = await readdir(directory, { withFileTypes: true });
  const manifests = await Promise.all(
    entries
      .filter(
        (entry) => entry.isDirectory() && /^[a-z][a-z0-9-]*$/u.test(entry.name),
      )
      .map(async (entry) =>
        PublicMediaSchema.parse(
          await Bun.file(path.join(directory, entry.name, "media.json")).json(),
        ),
      ),
  );
  const allowed = new Map<string, string>();
  const figures = manifests
    .map((manifest) => {
      const base = `/media/${manifest.name}`;
      for (const file of [
        "media.json",
        "poster.webp",
        manifest.kind === "video" ? "clip.mp4" : "original.webp",
        manifest.kind === "video" ? "annotated.mp4" : "annotated.webp",
      ])
        allowed.set(
          `${base}/${file}`,
          path.join(directory, manifest.name, file),
        );
      const element =
        manifest.kind === "video"
          ? `<video controls muted playsinline preload="metadata" src="${manifest.src}" poster="${manifest.poster}" width="${manifest.width.toString()}" height="${manifest.height.toString()}" aria-label="${escapeXml(manifest.alt)}"></video>`
          : `<img src="${manifest.src}" alt="${escapeXml(manifest.alt)}" width="${manifest.width.toString()}" height="${manifest.height.toString()}">`;
      return `<article><h2>${escapeXml(manifest.name)}</h2><storm-media data-manifest="${base}/media.json"><figure>${element}<figcaption>${escapeXml(manifest.caption)}</figcaption></figure></storm-media><a href="${base}/${manifest.kind === "video" ? "annotated.mp4" : "annotated.webp"}">Annotated export</a></article>`;
    })
    .join("");
  const style = await readFile(
    path.join(root, "packages/ts-mc-docs/src/styles/media.css"),
    "utf8",
  );
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capture review</title><style>:root{color-scheme:dark;--sl-color-gray-4:#637085;--sl-color-gray-6:#222a38}body{font:16px system-ui;background:#121823;color:#edf1f7;max-width:1100px;margin:auto;padding:24px}article{margin-block:32px}figure{margin:0}a{color:#8fcaff}${style}</style><h1>Capture review</h1>${figures}<script type="module" src="/component.js"></script></html>`;
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/")
        return new Response(html, {
          headers: { "content-type": "text/html;charset=utf-8" },
        });
      if (pathname === "/component.js")
        return new Response(script, {
          headers: { "content-type": "text/javascript" },
        });
      const file = allowed.get(pathname);
      return file === undefined
        ? new Response("Not found", { status: 404 })
        : new Response(Bun.file(file));
    },
  });
}
