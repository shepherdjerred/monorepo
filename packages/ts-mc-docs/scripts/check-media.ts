import path from "node:path";
import { file, Glob } from "bun";
import { PublicMediaSchema } from "@shepherdjerred/mc-harness/protocol/media.ts";

const root = path.resolve(import.meta.dirname, "..");
const publicRoot = path.join(root, "public");
const manifests = new Set<string>();
for await (const relative of new Glob("media/*/media.json").scan(publicRoot)) {
  const manifest = PublicMediaSchema.parse(
    await file(path.join(publicRoot, relative)).json(),
  );
  const base = `media/${manifest.name}`;
  if (relative !== `${base}/media.json`)
    throw new Error(`Media directory differs from manifest: ${relative}`);
  for (const name of [
    manifest.src.slice(1),
    manifest.poster.slice(1),
    `${base}/${manifest.kind === "video" ? "annotated.mp4" : "annotated.webp"}`,
  ]) {
    if (!(await file(path.join(publicRoot, name)).exists()))
      throw new Error(`Missing media derivative: ${name}`);
  }
  manifests.add(`/${relative}`);
}
for await (const relative of new Glob("**/*.html").scan(
  path.join(root, "dist"),
)) {
  const html = await file(path.join(root, "dist", relative)).text();
  for (const match of html.matchAll(
    /<storm-media\b[^>]*data-manifest="([^"]+)"/gu,
  )) {
    if (!manifests.has(match[1] ?? ""))
      throw new Error(
        `Unknown capture manifest in ${relative}: ${match[1] ?? ""}`,
      );
  }
}
process.stdout.write(
  `Validated ${manifests.size.toString()} capture manifests and all built media references.\n`,
);
