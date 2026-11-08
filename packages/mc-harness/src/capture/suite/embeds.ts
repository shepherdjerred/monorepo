import path from "node:path";
import { mediaFigure, mediaMarkup } from "#protocol/media-markup.ts";
import { PublicMediaSchema } from "#protocol/media.ts";
import type { PublicMedia } from "#protocol/media.ts";
import { command } from "./process.ts";

export function replaceFigures(
  text: string,
  manifests: Map<string, PublicMedia>,
): string {
  return text.replaceAll(
    /<div><storm-media data-manifest="\/media\/([a-z0-9-]+)\/media\.json">[\s\S]*?<\/storm-media><\/div>/gu,
    (original: string, name: string, offset: number) => {
      const manifest = manifests.get(name);
      if (manifest === undefined) return original;
      const download = `/media/${name}/annotated.${manifest.kind === "video" ? "mp4" : "webp"}`;
      const inline = original.includes(`href="${download}"`);
      const following = text.slice(offset + original.length);
      const external =
        /^\s*<p>\s*<a\s[^>]*href="([^"]+)"/u.exec(following)?.[1] === download;
      return inline && !external
        ? mediaMarkup(manifest)
        : mediaFigure(manifest);
    },
  );
}

/** Update only generated figures for outputs actually regenerated in this invocation. */
export async function syncEmbeds(
  repoRoot: string,
  names: string[],
): Promise<string[]> {
  const manifests = new Map<string, PublicMedia>();
  const formatted: string[] = [];
  for (const name of names) {
    const file = path.join(
      repoRoot,
      "packages/ts-mc-docs/public/media",
      name,
      "media.json",
    );
    const manifest = PublicMediaSchema.parse(await Bun.file(file).json());
    if (manifest.name !== name)
      throw new Error("Published media identity differs");
    manifests.set(name, manifest);
    formatted.push(file);
  }
  const docs = path.join(repoRoot, "packages/ts-mc-docs/src/content/docs");
  const changed: string[] = [];
  for await (const file of new Bun.Glob("**/*.md").scan(docs)) {
    const target = path.join(docs, file),
      before = await Bun.file(target).text();
    const after = replaceFigures(before, manifests);
    if (after !== before) {
      await Bun.write(target, after);
      changed.push(target);
    }
  }
  if (formatted.length + changed.length > 0)
    await command(
      [
        "bun",
        path.join(repoRoot, "node_modules/prettier/bin/prettier.cjs"),
        "--write",
        ...formatted,
        ...changed,
      ],
      undefined,
      { cwd: repoRoot },
    );
  return changed;
}
