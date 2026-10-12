import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadArticleSource } from "#lib/article.ts";
import { checkStep, renderWave } from "#lib/render.ts";

const site = path.resolve(import.meta.dirname, "..");
const resolve = (file: string) => path.resolve(site, file);
await mkdir(resolve("public/data"), { recursive: true });
await mkdir(resolve("public/fonts"), { recursive: true });
await mkdir(resolve("generated"), { recursive: true });
const font = await readFile(
  resolve(
    "../../../../../packages/scout-for-lol/packages/design-system/assets/fonts/BerkeleyMono/BerkeleyMono-Regular.woff2",
  ),
);
if (font.toString("ascii", 0, 4) !== "wOF2")
  throw new Error("Invalid Berkeley Mono WOFF2 input");
await writeFile(resolve("public/fonts/BerkeleyMono-Regular.woff2"), font);
const article = await loadArticleSource();
article.examples.forEach((example) => {
  checkStep(example);
});
const manifest: Record<string, string> = {};
for (const block of article.blocks) {
  if (block.kind !== "wave") continue;
  const data = JSON.stringify(await renderWave(block));
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);
  const filename = `${block.id}-${hash}.json`;
  manifest[block.id] = filename;
  await writeFile(resolve(`public/data/${filename}`), data);
  process.stdout.write(
    `${block.id}: ${String(block.steps.length)} steps, ${String(Buffer.byteLength(data))} bytes\n`,
  );
}
await writeFile(resolve("public/data/manifest.json"), JSON.stringify(manifest));
// Remove superseded generated payloads from the next static artifact.
const currentFiles = new Set(Object.values(manifest));
for (const name of await readdir(resolve("public/data"))) {
  if (/^wave-\d+-[\da-f]{12}\.json$/.test(name) && !currentFiles.has(name)) {
    await unlink(resolve(`public/data/${name}`));
  }
}
await writeFile(
  resolve("generated/article.ts"),
  `import type { Article } from "#lib/article.ts";\nconst article: Article = ${JSON.stringify(article)};\nexport const manifest: Record<string, string> = ${JSON.stringify(manifest)};\nexport default article;\n`,
);
