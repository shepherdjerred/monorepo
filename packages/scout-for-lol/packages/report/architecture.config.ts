import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * `@scout-for-lol/report` renders report images from Satori JSX. The package is
 * entirely render code, and it sits below the backend: it takes match and
 * report data in and returns SVG and PNG out.
 *
 * What is enforced here is what dependency-cruiser can see, which is the
 * package's own tree. `html/shared/` is the helper layer every report layout
 * builds on, so it must not import a layout, and `assets/` (fonts, colours,
 * style tokens) is a leaf beneath all of the rendering code.
 *
 * Not expressible here: "render must not import the backend". The cruise is
 * scoped to this package's own tree (`includeOnly`), so a cross-package edge is
 * invisible to it, and the package does not declare the backend as a
 * dependency. `eslint.config.ts` in the Scout root forbids the import instead.
 *
 * `src/dataDragon/` is not a layer because layer names are kebab-case and its
 * directory is camelCase; `architecture-boundaries.test.ts` lists it as the
 * one deliberate exception.
 */

/**
 * Every module and directory directly under `src/` (except the `index.ts`
 * barrel, `html` which is listed by its subdirectories, and `dataDragon`)
 * plus each directory of `src/html/`. `architecture-boundaries.test.ts`
 * asserts this list equals what is on disk.
 */
export const layers = [
  "assets",
  "browser",
  "html/arena",
  "html/champion",
  "html/charts",
  "html/classic",
  "html/lane",
  "html/loading-screen",
  "html/ranked",
  "html/ranked-banner",
  "html/ranked-square",
  "html/shared",
  "html/snapshot",
  "match",
  "testing",
];

/** Everything a layer may not depend on, written as what it *may*. */
function everythingExcept(...allowed: string[]): string[] {
  return layers.filter((layer) => !allowed.includes(layer));
}

export default defineArchitecture({
  boundaries: [
    {
      name: "html-shared-does-not-depend-on-a-layout",
      comment:
        "`html/shared/` holds the helpers every report layout builds on. Importing a layout " +
        "back would make a shared helper part of one layout's cycle and break the others.",
      from: "html/shared",
      to: everythingExcept("html/shared"),
    },
    {
      name: "assets-is-a-leaf",
      comment:
        "`assets/` holds fonts, colours and style tokens consumed by every renderer. It must not " +
        "import rendering code, or the tokens could not be loaded without the layouts that use them.",
      from: "assets",
      to: everythingExcept("assets"),
    },
  ],
});
