import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The marketing site is Astro: `pages/` and `layouts/` are almost entirely
 * `.astro`, with React islands under `components/`, shared helpers in `lib/`
 * and static content in `data/`.
 *
 * That shapes what can be enforced here, and it is worth being explicit about
 * it. dependency-cruiser reads the `.ts`/`.tsx` half of this package — 83
 * modules — and not the 38 `.astro` files, so these rules constrain the
 * islands and the helpers beneath them rather than the page tree. They are
 * still worth having: `lib/` and `data/` are what an island reaches for, and
 * they are the parts most likely to accrete a UI import.
 *
 * As in the web app, the client/server boundary is out of reach. The site
 * names the backend's `AppRouter` type in `lib/trpc.ts` and must never import
 * backend runtime, but each cruise is deliberately scoped to its own source
 * root, so a cross-package edge is invisible here. The boundary holds today;
 * enforcing it needs a different mechanism.
 */
export default defineArchitecture({
  boundaries: [
    {
      name: "lib-does-not-depend-on-the-site",
      comment:
        "`lib/` holds colours, marketing copy constants, the OG-image template and the tRPC " +
        "client — things a page or an island reaches for. Importing a component or a layout " +
        "back out of it inverts that and makes the helper unusable from an `.astro` file that " +
        "does not already render the component.",
      from: "lib",
      to: ["components", "data", "layouts", "pages"],
    },
    {
      name: "data-does-not-depend-on-the-site",
      comment:
        "`data/` is static content — the changelog and the showcase list. It is rendered by " +
        "components and pages, so depending on one would tie a piece of copy to a particular " +
        "presentation of it.",
      from: "data",
      to: ["components", "layouts", "lib", "pages"],
    },
  ],
});
