/**
 * Assembles the deployed Scout Storybook site.
 *
 * Two catalogs ship as one origin so the design system and the app's components
 * are reachable from a single sidebar: the design system at the root, the app
 * composed under `/app/` through Storybook's refs. They stay separate builds —
 * one has no Tailwind and no data layer, the other has both — and only the
 * output is joined.
 */
import { rm, mkdir, cp } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";

const scoutRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(scoutRoot, "../..");
const outputDir = path.join(scoutRoot, "storybook-site");

const designSystemOutput = path.join(
  scoutRoot,
  "packages/design-system/storybook-static",
);
const appOutput = path.join(scoutRoot, "packages/app/storybook-static");

// The design system's catalog is its `build`; the app's is a separate task so
// its own `build` stays the deployed SPA.
//
// SCOUT_STORYBOOK_COMPOSED is what turns on the ref to the app catalog. It is
// off by default because `bun run dev` has no /app to compose, and it is
// declared in the design system's turbo `build` env so a composed build does
// not reuse a plain build's cache entry.
process.env["SCOUT_STORYBOOK_COMPOSED"] = "true";
await $`bun x --no-install turbo run build --filter=@scout-for-lol/design-system`.cwd(
  repoRoot,
);

await $`bun x --no-install turbo run build:storybook --filter=@scout-for-lol/app`.cwd(
  repoRoot,
);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(designSystemOutput, outputDir, { recursive: true });
await cp(appOutput, path.join(outputDir, "app"), { recursive: true });

// Both builds emit the same 2,245 Scout assets, and every reference to them is
// an absolute `/assets/scout/...` URL — so the copy under /app/ is never
// requested, and dropping it halves what the deploy syncs. The root copy is
// always present: the design system's build is what produces it.
await rm(path.join(outputDir, "app/assets/scout"), {
  recursive: true,
  force: true,
});

console.log(`Assembled Scout Storybook site at ${outputDir}`);
