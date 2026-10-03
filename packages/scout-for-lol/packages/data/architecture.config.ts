import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * `@scout-for-lol/data` is the shared vocabulary: schemas, the ScoutQL v2
 * language, the Data Dragon catalogue and the review pipeline. Most of it is
 * one tangle of schemas that import each other freely, and these rules
 * describe only the parts that are genuinely one-way.
 *
 * - `model/scoutql/` is the query language. It builds on the report and core
 *   schemas and on nothing else, so the language can be compiled and tested
 *   without the rest of the model, or any consumer of it.
 * - `review/` is the top of the package: it consumes the model, Data Dragon and
 *   league catalogues. Nothing underneath may import it back.
 *
 * `model/legacy/` (the ScoutQL v1 language) is deliberately not a layer: it is
 * scheduled for deletion and no rule should have to know about it.
 *
 * Not expressible here: a rule from `model/` itself. Fixtures are matched by
 * file-name prefix, and `model-` would overlap the one that proves
 * `model/scoutql`. Cross-package edges are invisible too, because the cruise
 * only follows this package's own tree.
 */

/**
 * Every module and directory directly under `src/` (except the `index.ts`
 * barrel and `model`, which is listed by its subdirectories) plus each
 * directory of `src/model/`. `architecture-boundaries.test.ts` asserts this
 * list equals what is on disk.
 */
export const layers = [
  "browser-assets",
  "build-identity",
  "customs",
  "data-dragon",
  "example",
  "lane-priors",
  "league",
  "model/arena",
  "model/bucks",
  "model/competitions",
  "model/core",
  "model/matches",
  "model/operations",
  "model/permissions",
  "model/progression",
  "model/reports",
  "model/riot",
  "model/scoutql",
  "polling-config",
  "review",
  "scout-client",
  "seasons",
  "testing",
  "util",
];

/** Everything a layer may not depend on, written as what it *may*. */
function everythingExcept(...allowed: string[]): string[] {
  return layers.filter((layer) => !allowed.includes(layer));
}

export default defineArchitecture({
  boundaries: [
    {
      name: "scoutql-depends-only-on-core-and-reports",
      comment:
        "`model/scoutql/` is the ScoutQL v2 language. It compiles against the core and report " +
        "schemas and nothing else; reaching into another model slice, a catalogue or the review " +
        "pipeline would make the language impossible to test or reuse on its own.",
      from: "model/scoutql",
      to: everythingExcept("model/scoutql", "model/core", "model/reports"),
    },
    {
      name: "league-does-not-depend-on-review",
      comment:
        "`review/` consumes the league catalogues, not the other way round. An import back into " +
        "the review pipeline would turn a lookup table into part of a cycle.",
      from: "league",
      to: ["review"],
    },
    {
      name: "data-dragon-does-not-depend-on-review",
      comment:
        "`review/` consumes Data Dragon, not the other way round. Data Dragon is imported by " +
        "report rendering and the model, which must not transitively pull in the review pipeline.",
      from: "data-dragon",
      to: ["review"],
    },
  ],
});
