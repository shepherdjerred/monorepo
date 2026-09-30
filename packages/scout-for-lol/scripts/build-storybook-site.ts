/**
 * Assembles the deployed Scout Storybook site.
 *
 * Two catalogs ship as one origin so the design system and the app's components
 * are reachable from a single sidebar: the design system at the root, the app
 * composed under `/app/` through Storybook's refs. They stay separate builds —
 * one has no Tailwind and no data layer, the other has both — and only the
 * output is joined.
 *
 * This does not run turbo. The catalogs consume source exports; turbo `^build`
 * would typecheck and compile the backend/temporal closure, which a filtered
 * sites install cannot provide. Playwright already runs that graph.
 */
import { rm, mkdir, cp } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";

const scoutRoot = path.resolve(import.meta.dir, "..");
const outputDir = path.join(scoutRoot, "storybook-site");
const designSystemDir = path.join(scoutRoot, "packages/design-system");
const appDir = path.join(scoutRoot, "packages/app");

const designSystemOutput = path.join(designSystemDir, "storybook-static");
const appOutput = path.join(appDir, "storybook-static");

// The design system's catalog is its `build`; the app's is a separate task so
// its own `build` stays the deployed SPA.
//
// SCOUT_STORYBOOK_COMPOSED is what turns on the ref to the app catalog. It is
// off by default because `bun run dev` has no /app to compose, and it is
// declared in the design system's turbo `build` env so a composed turbo build
// does not reuse a plain build's cache entry. This script is not turbo, but
// Storybook still reads the same env.
process.env["SCOUT_STORYBOOK_COMPOSED"] = "true";
await $`bun --no-install run build`.cwd(designSystemDir);
await $`bun --no-install run build:storybook`.cwd(appDir);

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
