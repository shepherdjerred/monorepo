import path from "node:path";
import type { CaptureSuite } from "./define.ts";

async function missingReferences(publicRoot: string, docsRoot: string) {
  const missing: string[] = [];
  for await (const file of new Bun.Glob("**/*.{md,mdx}").scan(docsRoot)) {
    const text = await Bun.file(path.join(docsRoot, file)).text();
    for (const match of text.matchAll(
      /\/(?:media\/[a-z0-9-]+\/media\.json|screenshots\/[a-z0-9-]+\.webp|demos\/[a-z0-9-]+\.mp4)/gu,
    )) {
      const url = match[0];
      if (!(await Bun.file(path.join(publicRoot, url.slice(1))).exists()))
        missing.push(url);
    }
  }
  return missing;
}

/** Reconcile actual public assets with declared producers, including unembedded legacy URLs. */
export async function docsCoverage(
  suite: CaptureSuite,
  publicRoot: string,
  docsRoot?: string,
) {
  const shots = new Set(
    suite.scenarios.flatMap((scenario) =>
      scenario.shots.map((shot) => shot.name),
    ),
  );
  const aliases = new Set(
    (suite.legacyOutputs ?? []).map((output) => output.path),
  );
  const missing: string[] = [];
  let media = 0,
    legacy = 0;
  for await (const file of new Bun.Glob("media/*/media.json").scan(
    publicRoot,
  )) {
    media++;
    const name = path.basename(path.dirname(file));
    if (!shots.has(name)) missing.push(`/${file}`);
  }
  for (const pattern of ["screenshots/*.webp", "demos/*.mp4"]) {
    for await (const file of new Bun.Glob(pattern).scan(publicRoot)) {
      legacy++;
      if (!aliases.has(`/${file}`)) missing.push(`/${file}`);
    }
  }
  if (docsRoot !== undefined) {
    missing.push(...(await missingReferences(publicRoot, docsRoot)));
  }
  return { media, legacy, missing: [...new Set(missing)].sort() };
}
