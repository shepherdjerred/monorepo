import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * Monarch's deep paths are horizontal, not layered.
 *
 * Each vendor directory under `src/lib/` owns one merchant's fetch, parse,
 * match and classify pipeline — Amazon's Playwright scraper, Venmo's CSV
 * export, Conservice's PDFs, and so on. They run sequentially and share
 * nothing but the pipeline contracts in `classifier/`, `enrichment/` and
 * `monarch/`. There is no ordering among them, so the rule is not "A is below
 * B" but "none of them may reach into another": a matcher that learns another
 * vendor's shape stops being replaceable, and a change to one vendor's parser
 * silently becomes a change to two deep paths.
 *
 * `isolatedGroups` states that once. It expands to one boundary per member, so
 * adding an eighth vendor to the list forbids it in both directions with no
 * chance of an asymmetric hand-written matrix.
 *
 * The layers sit under `src/lib/`, not directly under the source root, and the
 * source root stays `src` on purpose: narrowing it to `src/lib` to shorten
 * these names would take `src/index.ts` out of the always-on cycle check.
 */
const vendors = [
  "lib/amazon",
  "lib/apple",
  "lib/conservice",
  "lib/costco",
  "lib/scl",
  "lib/usaa",
  "lib/venmo",
];

export default defineArchitecture({
  isolatedGroups: [
    {
      name: "vendor-adapters-are-self-contained",
      comment:
        "Each vendor directory owns one merchant's fetch, parse, match and classify pipeline. " +
        "They share the pipeline contracts in `classifier/`, `enrichment/` and `monarch/` and " +
        "nothing else. Reading another vendor's modules couples two deep paths that are supposed " +
        "to be independently replaceable — pull whatever is genuinely common up into the shared " +
        "pipeline instead of reaching sideways.",
      layers: vendors,
    },
  ],
  boundaries: [
    {
      name: "monarch-client-does-not-depend-on-the-pipeline",
      comment:
        "`lib/monarch/` is the Monarch Money API client: fetching transactions and categories and " +
        "writing changes back. It is called by the pipeline and knows nothing about " +
        "classification, enrichment or any particular merchant, which is what lets it be " +
        "exercised on its own against the live API.",
      from: "lib/monarch",
      to: [...vendors, "lib/classifier", "lib/enrichment", "lib/verification"],
    },
  ],
});
